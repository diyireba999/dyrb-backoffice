-- DYRB Back Office: payroll (Phase 5)
-- Run in Supabase SQL Editor after 001, 002 and 003.
--
-- Rates are kept in a table you can edit on the Payroll Settings screen, so a
-- change in the law does not need new code. Every amount on a payslip can also
-- be typed over before the run is approved.

-- ---------- Rates ----------
create table payroll_rates (
  id int primary key default 1 check (id = 1),
  epf_employee_local numeric not null default 11,      -- %
  epf_employer_local_low numeric not null default 13,  -- wage <= threshold
  epf_employer_local_high numeric not null default 12,
  epf_wage_threshold numeric not null default 5000,
  epf_employee_foreign numeric not null default 2,
  epf_employer_foreign numeric not null default 2,
  socso_employee numeric not null default 0.5,
  socso_employer numeric not null default 1.75,
  socso_employer_foreign numeric not null default 1.25, -- work injury only
  socso_wage_ceiling numeric not null default 6000,
  eis_employee numeric not null default 0.2,
  eis_employer numeric not null default 0.2,
  eis_wage_ceiling numeric not null default 6000,
  minimum_wage numeric not null default 1700,
  ot_normal numeric not null default 1.5,              -- multiples of hourly rate
  ot_rest_day numeric not null default 2.0,
  ot_public_holiday numeric not null default 3.0,
  updated_at timestamptz not null default now()
);
insert into payroll_rates (id) values (1);

alter table payroll_rates enable row level security;
create policy "office reads" on payroll_rates for select using (is_office());
create policy "owner or accountant edits" on payroll_rates for update
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- ---------- Employees ----------
create type pay_type as enum ('monthly', 'hourly');

create table employees (
  id bigint generated always as identity primary key,
  profile_id uuid unique references profiles,   -- links to their login, for viewing own payslips
  employee_no text,
  name text not null,
  id_no text,                                   -- IC or passport number
  is_local boolean not null default true,
  position text,
  join_date date,
  leave_date date,
  pay_type pay_type not null default 'monthly',
  rate numeric(12,2) not null default 0,        -- monthly salary, or rate per hour
  bank_name text,
  bank_account text,
  epf_no text, socso_no text, tax_no text,
  epf_on boolean not null default true,
  socso_on boolean not null default true,
  eis_on boolean not null default true,
  pcb_on boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table employees enable row level security;
create policy "office reads all, staff read own" on employees for select
  using (is_office() or profile_id = auth.uid());
create policy "owner or accountant edits" on employees for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- ---------- Payroll runs and payslips ----------
create type run_status as enum ('draft', 'approved');

create table payroll_runs (
  id bigint generated always as identity primary key,
  month date not null unique,                   -- always the 1st of the month
  pay_date date not null,
  status run_status not null default 'draft',
  journal_id bigint references journals,
  approved_by uuid references profiles,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table payslips (
  id bigint generated always as identity primary key,
  run_id bigint not null references payroll_runs on delete cascade,
  employee_id bigint not null references employees,
  basic numeric(12,2) not null default 0,
  hours numeric(8,2) not null default 0,
  hourly_rate numeric(12,2) not null default 0,
  ot_hours numeric(8,2) not null default 0,
  ot_amount numeric(12,2) not null default 0,
  allowance numeric(12,2) not null default 0,
  service_charge numeric(12,2) not null default 0,
  unpaid_leave numeric(12,2) not null default 0,
  other_deduction numeric(12,2) not null default 0,
  epf_employee numeric(12,2) not null default 0,
  epf_employer numeric(12,2) not null default 0,
  socso_employee numeric(12,2) not null default 0,
  socso_employer numeric(12,2) not null default 0,
  eis_employee numeric(12,2) not null default 0,
  eis_employer numeric(12,2) not null default 0,
  pcb numeric(12,2) not null default 0,
  note text,
  unique (run_id, employee_id)
);

-- Gross pay and net pay are always derived, never typed in.
create view payslip_view with (security_invoker = true) as
  select p.*, e.name, e.employee_no, e.id_no, e.is_local, e.position, e.bank_name, e.bank_account,
         e.epf_no, e.socso_no, e.tax_no, e.profile_id, r.month, r.pay_date, r.status,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave) as gross,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction) as net_pay,
         (p.epf_employer + p.socso_employer + p.eis_employer) as employer_cost
  from payslips p
  join employees e on e.id = p.employee_id
  join payroll_runs r on r.id = p.run_id;

alter table payroll_runs enable row level security;
alter table payslips enable row level security;
create policy "office reads" on payroll_runs for select using (is_office());
create policy "office reads all, staff read own" on payslips for select
  using (is_office() or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
revoke insert, update, delete on payroll_runs, payslips from anon, authenticated;

-- ---------- Working out the contributions ----------
-- Wage used for EPF / SOCSO / EIS. Every figure can be typed over on the payslip
-- before the run is approved, so unusual cases are still handled.
create function statutory_for(p_wage numeric, p_is_local boolean,
                              p_epf boolean, p_socso boolean, p_eis boolean)
returns table (epf_employee numeric, epf_employer numeric, socso_employee numeric,
               socso_employer numeric, eis_employee numeric, eis_employer numeric)
language plpgsql stable as $$
declare r payroll_rates; socso_wage numeric; eis_wage numeric;
begin
  select * into r from payroll_rates where id = 1;
  socso_wage := least(greatest(p_wage, 0), r.socso_wage_ceiling);
  eis_wage := least(greatest(p_wage, 0), r.eis_wage_ceiling);

  -- EPF is rounded up to the next ringgit, as KWSP does.
  if p_epf and p_wage > 0 then
    if p_is_local then
      epf_employee := ceil(p_wage * r.epf_employee_local / 100);
      epf_employer := ceil(p_wage * (case when p_wage <= r.epf_wage_threshold
                                          then r.epf_employer_local_low else r.epf_employer_local_high end) / 100);
    else
      epf_employee := ceil(p_wage * r.epf_employee_foreign / 100);
      epf_employer := ceil(p_wage * r.epf_employer_foreign / 100);
    end if;
  else
    epf_employee := 0; epf_employer := 0;
  end if;

  if p_socso and p_wage > 0 then
    -- Foreign workers: employer pays the work injury part only, nothing from the worker.
    socso_employee := case when p_is_local then round(socso_wage * r.socso_employee / 100, 2) else 0 end;
    socso_employer := round(socso_wage * (case when p_is_local then r.socso_employer else r.socso_employer_foreign end) / 100, 2);
  else
    socso_employee := 0; socso_employer := 0;
  end if;

  -- EIS does not apply to foreign workers.
  if p_eis and p_is_local and p_wage > 0 then
    eis_employee := round(eis_wage * r.eis_employee / 100, 2);
    eis_employer := round(eis_wage * r.eis_employer / 100, 2);
  else
    eis_employee := 0; eis_employer := 0;
  end if;
  return next;
end $$;

-- Start (or re-open) a month: one draft payslip per active employee.
create function create_payroll_run(p_month date, p_pay_date date) returns bigint
language plpgsql security definer set search_path = public as $$
declare run bigint; e employees; s record; first_day date := date_trunc('month', p_month)::date;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can start payroll'; end if;
  if exists (select 1 from payroll_runs where month = first_day) then raise exception 'This month already exists'; end if;
  insert into payroll_runs (month, pay_date) values (first_day, p_pay_date) returning id into run;
  for e in select * from employees where active and (join_date is null or join_date <= (first_day + interval '1 month' - interval '1 day'))
                                     and (leave_date is null or leave_date >= first_day) loop
    select * into s from statutory_for(case when e.pay_type = 'monthly' then e.rate else 0 end,
                                       e.is_local, e.epf_on, e.socso_on, e.eis_on);
    insert into payslips (run_id, employee_id, basic, hourly_rate,
                          epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer)
      values (run, e.id, case when e.pay_type = 'monthly' then e.rate else 0 end,
              case when e.pay_type = 'hourly' then e.rate else 0 end,
              s.epf_employee, s.epf_employer, s.socso_employee, s.socso_employer, s.eis_employee, s.eis_employer);
  end loop;
  return run;
end $$;

-- Save one payslip. p_recalc = true works the contributions out again from the new pay.
create function save_payslip(p_id bigint, p_fields jsonb, p_recalc boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare p payslips; e employees; wage numeric; s record; st run_status;
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
    wage := p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave;
    select * into s from statutory_for(wage, e.is_local, e.epf_on, e.socso_on, e.eis_on);
    update payslips set epf_employee = s.epf_employee, epf_employer = s.epf_employer,
      socso_employee = s.socso_employee, socso_employer = s.socso_employer,
      eis_employee = s.eis_employee, eis_employer = s.eis_employer
    where id = p_id;
  end if;
end $$;

create function delete_payslip(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Not allowed'; end if;
  delete from payslips p using payroll_runs r where p.id = p_id and r.id = p.run_id and r.status = 'draft';
end $$;

-- Approve: locks the month and posts the salary journal.
create function approve_payroll_run(p_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare r payroll_runs; t record; j bigint; lines jsonb := '[]'::jsonb;
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can approve payroll'; end if;
  select * into r from payroll_runs where id = p_id for update;
  if r.status <> 'draft' then raise exception 'Already approved'; end if;
  select coalesce(sum(gross), 0) gross, coalesce(sum(epf_employee), 0) epf_e, coalesce(sum(epf_employer), 0) epf_r,
         coalesce(sum(socso_employee), 0) soc_e, coalesce(sum(socso_employer), 0) soc_r,
         coalesce(sum(eis_employee), 0) eis_e, coalesce(sum(eis_employer), 0) eis_r,
         coalesce(sum(pcb), 0) pcb, coalesce(sum(other_deduction), 0) other, coalesce(sum(net_pay), 0) net
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

  j := post_journal(r.pay_date, 'Payroll ' || to_char(r.month, 'Mon YYYY'), 'payroll', p_id::text, null, lines);
  update payroll_runs set status = 'approved', journal_id = j, approved_by = auth.uid(), approved_at = now() where id = p_id;
  return j;
end $$;

-- Cancel an approved run (or delete a draft): removes the journal too.
create function cancel_payroll_run(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare j bigint;
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can cancel payroll'; end if;
  select journal_id into j from payroll_runs where id = p_id;
  update payroll_runs set status = 'draft', journal_id = null, approved_by = null, approved_at = null where id = p_id;
  if j is not null then delete from journals where id = j; end if;
end $$;

create function delete_payroll_run(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can delete payroll'; end if;
  if exists (select 1 from payroll_runs where id = p_id and status <> 'draft') then
    raise exception 'Cancel the approved payroll first'; end if;
  delete from payroll_runs where id = p_id;
end $$;
