-- DYRB Back Office: staff salary advances (019)
-- Run in Supabase SQL Editor after 018_docedit.sql.
--
-- An advance is money lent to a staff member before payday. It leaves the till
-- straight away and is owed back, so it sits as an asset in 1310 until it is
-- taken out of a payslip. Recovery is recorded per run in advance_recoveries,
-- so cancelling a payroll run puts the balance back by itself.

-- Map 'advance' source to document prefix 'SA' (Staff Advance).
-- Must be defined before any advance journals are posted.
create or replace function doc_prefix(p_source text) returns text language sql immutable as $$
  select case p_source
    when 'pv' then 'PV' when 'or' then 'OR' when 'transfer' then 'TR'
    when 'pi' then 'PI' when 'sp' then 'SP' when 'claim' then 'CL'
    when 'sales' then 'SL' when 'fiuu' then 'FS' when 'payroll' then 'PR'
    when 'cogs' then 'CS' when 'accrual' then 'AC' when 'stock' then 'SC'
    when 'advance' then 'SA'
    else 'JV' end
$$;

insert into accounts (code, name, type) values
  ('1310', 'Staff Advances', 'asset')
on conflict (code) do nothing;

create table if not exists staff_advances (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  journal_id bigint not null references journals,
  note text,
  created_at timestamptz not null default now()
);

-- How much of each advance has been taken back, and by which payroll run.
create table if not exists advance_recoveries (
  advance_id bigint not null references staff_advances on delete cascade,
  run_id bigint not null references payroll_runs on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  primary key (advance_id, run_id)
);

alter table staff_advances enable row level security;
alter table advance_recoveries enable row level security;
create policy "office reads all, staff read own" on staff_advances for select
  using (is_office() or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
create policy "office reads" on advance_recoveries for select using (is_office());
revoke insert, update, delete on staff_advances, advance_recoveries from anon, authenticated;

-- Outstanding per advance, oldest first.
create or replace view advance_balances with (security_invoker = true) as
  select a.id, a.employee_id, a.date, a.amount, a.note, a.journal_id,
         a.amount - coalesce((select sum(r.amount) from advance_recoveries r where r.advance_id = a.id), 0) as outstanding
  from staff_advances a;

create or replace function record_advance(p_employee bigint, p_date date, p_amount numeric,
                                          p_from text, p_note text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint; adv bigint; who text;
begin
  if my_role() not in ('owner', 'accountant') then
    raise exception 'Only owner or accountant can give a salary advance'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount'; end if;
  if p_from not in ('1000', '1010', '1100') then
    raise exception 'Pay the advance from cash, petty cash or bank'; end if;
  select name into who from employees where id = p_employee;
  if who is null then raise exception 'Staff member not found'; end if;

  j := post_journal(p_date, 'Salary advance – ' || who, 'advance', null, null,
    jsonb_build_array(jsonb_build_object('account', '1310', 'debit', p_amount, 'memo', p_note),
                      jsonb_build_object('account', p_from, 'credit', p_amount)));
  insert into staff_advances (employee_id, date, amount, journal_id, note)
    values (p_employee, p_date, p_amount, j, nullif(p_note, '')) returning id into adv;
  return adv;
end $$;

-- An advance can only be removed while none of it has been taken back.
create or replace function delete_advance(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then
    raise exception 'Only owner or accountant can remove an advance'; end if;
  if exists (select 1 from advance_recoveries where advance_id = p_id) then
    raise exception 'Part of this advance has already been taken back on a payslip'; end if;
  select journal_id into j from staff_advances where id = p_id;
  if j is null then raise exception 'Advance not found'; end if;
  delete from staff_advances where id = p_id;
  delete from journals where id = j;
end $$;

-- ---------- Recover a staff salary advance through the next payslip ----------
-- Deduct the whole outstanding advance, capped at that month's net pay so pay
-- can never go negative. Whatever the cap leaves behind is still outstanding
-- and comes off automatically the following month. No repayment schedule.

alter table payslips add column if not exists advance_recovery numeric(12,2) not null default 0;

-- payslip_view starts with p.*, so a new column on payslips shifts the
-- ordinals and `create or replace view` refuses. A view holds no data, so
-- this is the one drop permitted in this plan.
drop view if exists payslip_view;
create view payslip_view with (security_invoker = true) as
  select p.*, e.name, e.employee_no, e.id_no, e.is_local, e.position, e.bank_name, e.bank_account,
         e.epf_no, e.socso_no, e.tax_no, e.profile_id, r.month, r.pay_date, r.status,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave) as gross,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction
          - p.advance_recovery) as net_pay,
         (p.epf_employer + p.socso_employer + p.eis_employer) as employer_cost
  from payslips p
  join employees e on e.id = p.employee_id
  join payroll_runs r on r.id = p.run_id;

-- What this payslip should take back: everything still owed, but never more
-- than the pay left after tax and the other deductions.
create or replace function advance_to_recover(p_payslip bigint) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p payslips; owed numeric; room numeric;
begin
  select * into p from payslips where id = p_payslip;
  if p.id is null then return 0; end if;
  select coalesce(sum(b.outstanding), 0) into owed from advance_balances b
    where b.employee_id = p.employee_id and b.outstanding > 0
      and b.date <= (select (r.month + interval '1 month' - interval '1 day')::date
                       from payroll_runs r where r.id = p.run_id);
  room := p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction;
  return greatest(least(owed, room), 0);
end $$;

-- Start (or re-open) a month: one draft payslip per active employee.
-- Copied from 016_fixes2.sql (the corrected wage-base version: epf_wage
-- excludes OT and service charge, socso_wage includes them, six-argument
-- statutory_for), with the recovery figure set once after the loop.
create or replace function create_payroll_run(p_month date, p_pay_date date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare run bigint; e employees; s record; first_day date := date_trunc('month', p_month)::date; pay numeric;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can start payroll'; end if;
  if exists (select 1 from payroll_runs where month = first_day) then raise exception 'This month already exists'; end if;
  insert into payroll_runs (month, pay_date) values (first_day, p_pay_date) returning id into run;
  for e in select * from employees where active and (join_date is null or join_date <= (first_day + interval '1 month' - interval '1 day'))
                                     and (leave_date is null or leave_date >= first_day) loop
    pay := case when e.pay_type = 'monthly' then e.rate else 0 end;
    select * into s from statutory_for(pay, pay, e.is_local, e.epf_on, e.socso_on, e.eis_on);
    insert into payslips (run_id, employee_id, basic, hourly_rate,
                          epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer)
      values (run, e.id, pay, case when e.pay_type = 'hourly' then e.rate else 0 end,
              s.epf_employee, s.epf_employer, s.socso_employee, s.socso_employer, s.eis_employee, s.eis_employer);
  end loop;
  update payslips set advance_recovery = advance_to_recover(id) where run_id = run;
  return run;
end $$;

-- Save one payslip. p_recalc = true works the contributions out again from the new pay.
-- Copied from 016_fixes2.sql (corrected wage-base version). The recovery
-- refresh is the last statement, after the statutory recalculation, because
-- its cap is net pay and net pay depends on EPF/SOCSO/EIS/PCB being final.
create or replace function save_payslip(p_id bigint, p_fields jsonb, p_recalc boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p payslips; e employees; epf_wage numeric; socso_wage numeric; s record; st run_status;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can edit payroll'; end if;
  select r.status into st from payslips ps join payroll_runs r on r.id = ps.run_id where ps.id = p_id;
  if st is null then raise exception 'Payslip not found'; end if;
  if st <> 'draft' then raise exception 'This payroll is approved already. Cancel it first to change anything.'; end if;

  update payslips set
    basic = coalesce((p_fields->>'basic')::numeric, basic),
    hours = coalesce((p_fields->>'hours')::numeric, hours),
    hourly_rate = coalesce((p_fields->>'hourly_rate')::numeric, hourly_rate),
    ot_hours = coalesce((p_fields->>'ot_hours')::numeric, ot_hours),
    ot_amount = coalesce((p_fields->>'ot_amount')::numeric, ot_amount),
    allowance = coalesce((p_fields->>'allowance')::numeric, allowance),
    service_charge = coalesce((p_fields->>'service_charge')::numeric, service_charge),
    unpaid_leave = coalesce((p_fields->>'unpaid_leave')::numeric, unpaid_leave),
    other_deduction = coalesce((p_fields->>'other_deduction')::numeric, other_deduction),
    epf_employee = coalesce((p_fields->>'epf_employee')::numeric, epf_employee),
    epf_employer = coalesce((p_fields->>'epf_employer')::numeric, epf_employer),
    socso_employee = coalesce((p_fields->>'socso_employee')::numeric, socso_employee),
    socso_employer = coalesce((p_fields->>'socso_employer')::numeric, socso_employer),
    eis_employee = coalesce((p_fields->>'eis_employee')::numeric, eis_employee),
    eis_employer = coalesce((p_fields->>'eis_employer')::numeric, eis_employer),
    pcb = coalesce((p_fields->>'pcb')::numeric, pcb),
    note = coalesce(p_fields->>'note', note)
  where id = p_id returning * into p;

  if p_recalc then
    select * into e from employees where id = p.employee_id;
    -- Hourly staff: pay is hours x rate.
    if e.pay_type = 'hourly' then
      update payslips set basic = round(p.hours * p.hourly_rate, 2) where id = p_id returning * into p;
    end if;
    epf_wage := p.basic + p.allowance - p.unpaid_leave;                             -- no OT, no service charge
    socso_wage := p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave;
    select * into s from statutory_for(epf_wage, socso_wage, e.is_local, e.epf_on, e.socso_on, e.eis_on);
    update payslips set epf_employee = s.epf_employee, epf_employer = s.epf_employer,
      socso_employee = s.socso_employee, socso_employer = s.socso_employer,
      eis_employee = s.eis_employee, eis_employer = s.eis_employer
    where id = p_id;
  end if;

  update payslips set advance_recovery = advance_to_recover(id) where id = p_id;
end $$;

-- Approve: locks the month and posts the salary journal.
-- Copied from 004_payroll.sql, with the advance recovery credit added to the
-- journal and the recovery rows written per advance, oldest first.
create or replace function approve_payroll_run(p_id bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r payroll_runs; t record; j bigint; lines jsonb := '[]'::jsonb;
        slip record; b record; left_to_take numeric; take numeric;
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can approve payroll'; end if;
  select * into r from payroll_runs where id = p_id for update;
  if r.status <> 'draft' then raise exception 'Already approved'; end if;
  select coalesce(sum(gross), 0) gross, coalesce(sum(epf_employee), 0) epf_e, coalesce(sum(epf_employer), 0) epf_r,
         coalesce(sum(socso_employee), 0) soc_e, coalesce(sum(socso_employer), 0) soc_r,
         coalesce(sum(eis_employee), 0) eis_e, coalesce(sum(eis_employer), 0) eis_r,
         coalesce(sum(pcb), 0) pcb, coalesce(sum(other_deduction), 0) other, coalesce(sum(net_pay), 0) net,
         coalesce(sum(advance_recovery), 0) adv
    into t from payslip_view where run_id = p_id;
  if t.gross <= 0 then raise exception 'Nothing to approve'; end if;

  lines := jsonb_build_array(
    jsonb_build_object('account', '6000', 'debit', t.gross, 'memo', 'Salaries and wages'),
    jsonb_build_object('account', '2300', 'credit', t.net, 'memo', 'Net pay to staff'));
  if t.epf_e + t.epf_r > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', '2310', 'credit', t.epf_e + t.epf_r));
    if t.epf_r > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', '6010', 'debit', t.epf_r)); end if;
  end if;
  if t.soc_e + t.soc_r > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', '2320', 'credit', t.soc_e + t.soc_r));
    if t.soc_r > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', '6020', 'debit', t.soc_r)); end if;
  end if;
  if t.eis_e + t.eis_r > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', '2330', 'credit', t.eis_e + t.eis_r));
    if t.eis_r > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', '6030', 'debit', t.eis_r)); end if;
  end if;
  if t.pcb > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', '2340', 'credit', t.pcb)); end if;
  if t.other > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', '6000', 'credit', t.other, 'memo', 'Staff deductions')); end if;
  if t.adv > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object(
      'account', '1310', 'credit', t.adv, 'memo', 'Salary advance recovered'));
  end if;

  j := post_journal(r.pay_date, 'Payroll ' || to_char(r.month, 'Mon YYYY'), 'payroll', p_id::text, null, lines);
  update payroll_runs set status = 'approved', journal_id = j, approved_by = auth.uid(), approved_at = now() where id = p_id;

  -- Walk each payslip's recovery against that employee's outstanding
  -- advances, oldest first, so the longest-standing debt clears first.
  for slip in select s.id, s.employee_id, s.advance_recovery from payslips s
              where s.run_id = p_id and s.advance_recovery > 0 loop
    left_to_take := slip.advance_recovery;
    for b in select * from advance_balances
             where employee_id = slip.employee_id and outstanding > 0 order by date, id loop
      exit when left_to_take <= 0;
      take := least(left_to_take, b.outstanding);
      insert into advance_recoveries (advance_id, run_id, amount) values (b.id, p_id, take);
      left_to_take := left_to_take - take;
    end loop;
  end loop;

  return j;
end $$;

-- Cancel an approved run (or delete a draft): removes the journal too.
-- Copied from 004_payroll.sql; the advance recoveries recorded on approval
-- are removed first, so the outstanding figure corrects itself (it is
-- derived, not stored).
create or replace function cancel_payroll_run(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can cancel payroll'; end if;
  select journal_id into j from payroll_runs where id = p_id;
  delete from advance_recoveries where run_id = p_id;
  update payroll_runs set status = 'draft', journal_id = null, approved_by = null, approved_at = null where id = p_id;
  if j is not null then delete from journals where id = j; end if;
end $$;
