-- DYRB Back Office: monthly timesheet (020)
-- Run in Supabase SQL Editor after 019_advance.sql.
--
-- Hours used to be typed straight onto the payslip with nothing behind them.
-- They now come from a grid of days, so there is a record of where the figure
-- came from. It is a timesheet, not a clock — nobody taps in or out. Every
-- figure can still be typed over on the payslip before the run is approved.
--
-- Overtime here pays only at the normal (1.5x) rate against an hourly
-- employee's rate. Rest-day (2x) and public-holiday (3x) multipliers exist in
-- payroll_rates but need a holiday calendar to tell which days those were;
-- that is out of scope, so those cases are handled by overriding ot_amount by
-- hand on the payslip. Monthly staff have no hourly rate, so seeding always
-- gives them an ot_amount of 0 — their OT is still entered by hand, as today.

create table if not exists timesheets (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees,
  work_date date not null,
  hours numeric(5,2) not null default 0 check (hours >= 0),
  ot_hours numeric(5,2) not null default 0 check (ot_hours >= 0),
  note text,
  unique (employee_id, work_date)
);

alter table timesheets enable row level security;
do $$ begin create policy "office reads all, staff read own" on timesheets for select
  using (is_office() or exists (select 1 from employees e where e.id = employee_id and e.profile_id = auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin create policy "office writes" on timesheets for all
  using (is_office()) with check (is_office());
exception when duplicate_object then null; end $$;

-- Monthly totals per person, for the payroll run to pick up.
create or replace view timesheet_months with (security_invoker = true) as
  select employee_id, date_trunc('month', work_date)::date as month,
         sum(hours) as hours, sum(ot_hours) as ot_hours
  from timesheets group by employee_id, date_trunc('month', work_date)::date;

-- Start (or re-open) a month: one draft payslip per active employee.
-- Copied from 019_advance.sql (which carries the corrected wage-base
-- statutory_for call and the post-loop advance recovery), with hours/OT now
-- seeded per employee from that month's timesheet before each insert.
create or replace function create_payroll_run(p_month date, p_pay_date date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare run bigint; e employees; s record; first_day date := date_trunc('month', p_month)::date; pay numeric;
        ts_hours numeric; ts_ot numeric; ot_pay numeric; rates payroll_rates;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can start payroll'; end if;
  if exists (select 1 from payroll_runs where month = first_day) then raise exception 'This month already exists'; end if;
  select * into rates from payroll_rates where id = 1;
  insert into payroll_runs (month, pay_date) values (first_day, p_pay_date) returning id into run;
  for e in select * from employees where active and (join_date is null or join_date <= (first_day + interval '1 month' - interval '1 day'))
                                     and (leave_date is null or leave_date >= first_day) loop
    select coalesce(t.hours, 0), coalesce(t.ot_hours, 0) into ts_hours, ts_ot
      from timesheet_months t where t.employee_id = e.id and t.month = first_day;
    if not found then ts_hours := 0; ts_ot := 0; end if;

    -- Seed basic and OT first, then base EPF/SOCSO/EIS on those actual figures
    -- (same wage-base split save_payslip uses) — not on 0, which is what an
    -- hourly employee's pay used to be before the timesheet fed it a real
    -- number. EPF excludes OT; SOCSO includes it.
    pay := case when e.pay_type = 'monthly' then e.rate else round(ts_hours * e.rate, 2) end;
    ot_pay := round(ts_ot * (case when e.pay_type = 'hourly' then e.rate else 0 end) * rates.ot_normal, 2);
    select * into s from statutory_for(pay, pay + ot_pay, e.is_local, e.epf_on, e.socso_on, e.eis_on);

    insert into payslips (run_id, employee_id, basic, hourly_rate, hours, ot_hours, ot_amount,
                          epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer)
      values (run, e.id, pay,
              case when e.pay_type = 'hourly' then e.rate else 0 end,
              ts_hours, ts_ot, ot_pay,
              s.epf_employee, s.epf_employer, s.socso_employee, s.socso_employer, s.eis_employee, s.eis_employer);
  end loop;
  update payslips set advance_recovery = advance_to_recover(id) where run_id = run;
  return run;
end $$;
