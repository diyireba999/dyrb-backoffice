-- DYRB Back Office: 10-hour day, monthly OT, re-run a draft payroll (027)
-- Run in Supabase SQL Editor after 026_company.sql. Safe to run again.
--
-- 1. Staff work 10 hours a day, 28 days a month. hours_per_day is the normal
--    day the timesheet fills in, and it sets a monthly employee's hourly rate:
--    salary / (working_days x hours_per_day). Monthly staff OT used to seed as
--    0 (no hourly rate); it is now OT hours x that rate x ot_normal.
-- 2. A draft run can be re-run: its payslips are thrown away and built again
--    from the current timesheet, staff list and rates. Hand edits are lost.

alter table payroll_rates add column if not exists hours_per_day numeric not null default 10
  check (hours_per_day > 0 and hours_per_day <= 24);
update payroll_rates set working_days = 28 where id = 1;

-- Copied from 025_prorate.sql (the current version); only the OT rate changed.
create or replace function create_payroll_run(p_month date, p_pay_date date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare run bigint; e employees; s record; first_day date := date_trunc('month', p_month)::date;
        last_day date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
        dim int; pay numeric; ts_hours numeric; ts_ot numeric; ts_rows int; ts_present int;
        ot_pay numeric; rates payroll_rates; employed int; expected int; absent int; unpaid numeric; note text;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can start payroll'; end if;
  if exists (select 1 from payroll_runs where month = first_day) then raise exception 'This month already exists'; end if;
  select * into rates from payroll_rates where id = 1;
  dim := extract(day from last_day)::int;
  insert into payroll_runs (month, pay_date) values (first_day, p_pay_date) returning id into run;
  for e in select * from employees where active and (join_date is null or join_date <= last_day)
                                     and (leave_date is null or leave_date >= first_day) loop
    select coalesce(sum(t.hours), 0), coalesce(sum(t.ot_hours), 0), count(*), count(*) filter (where t.hours > 0)
      into ts_hours, ts_ot, ts_rows, ts_present
      from timesheets t where t.employee_id = e.id and t.work_date between first_day and last_day;

    unpaid := 0; note := null;
    if e.pay_type = 'monthly' then
      employed := least(coalesce(e.leave_date, last_day), last_day) - greatest(coalesce(e.join_date, first_day), first_day) + 1;
      pay := case when employed >= dim then e.rate else round(e.rate * employed / dim, 2) end;
      if employed < dim then note := format('Pro-rated %s of %s days', employed, dim); end if;
      if ts_rows > 0 then
        expected := round(rates.working_days * employed / dim);
        absent := greatest(expected - ts_present, 0);
        unpaid := least(round(absent * e.rate / rates.working_days, 2), pay);
        if absent > 0 then
          note := concat_ws(' · ', note, format('%s of %s working days absent', absent, expected));
        end if;
      end if;
    else
      pay := round(ts_hours * e.rate, 2);
    end if;
    ot_pay := round(ts_ot * rates.ot_normal * case when e.pay_type = 'hourly' then e.rate
                                                   else e.rate / (rates.working_days * rates.hours_per_day) end, 2);
    -- EPF excludes OT; SOCSO includes it. Both net of unpaid leave.
    select * into s from statutory_for(pay - unpaid, pay + ot_pay - unpaid, e.is_local, e.epf_on, e.socso_on, e.eis_on);

    insert into payslips (run_id, employee_id, basic, hourly_rate, hours, ot_hours, ot_amount, unpaid_leave, note,
                          epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer)
      values (run, e.id, pay,
              case when e.pay_type = 'hourly' then e.rate else 0 end,
              ts_hours, ts_ot, ot_pay, unpaid, note,
              s.epf_employee, s.epf_employer, s.socso_employee, s.socso_employer, s.eis_employee, s.eis_employer);
  end loop;
  update payslips set advance_recovery = advance_to_recover(id) where run_id = run;
  return run;
end $$;

-- Re-run a draft: drop it (payslips cascade) and create it again for the same
-- month and pay date. Returns the new run id.
create or replace function rerun_payroll_run(p_id bigint) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r payroll_runs;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can re-run payroll'; end if;
  select * into r from payroll_runs where id = p_id;
  if r.id is null then raise exception 'Payroll not found'; end if;
  if r.status <> 'draft' then raise exception 'This payroll is approved already. Cancel it first to re-run it.'; end if;
  delete from payroll_runs where id = p_id;
  return create_payroll_run(r.month, r.pay_date);
end $$;
