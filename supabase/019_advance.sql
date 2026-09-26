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
