-- DYRB Back Office: pro-rated monthly salary (025)
-- Run in Supabase SQL Editor after 024_investor.sql. Safe to run again.
--
-- Monthly staff used to get their full rate no matter when they joined or left
-- or how many days they turned up. Two rules now apply when a run is created:
--
--   1. Join or leave mid-month: basic = rate x calendar days employed / days in
--      the month (the Employment Act rule for an incomplete month).
--   2. Absent days: if the employee has ANY timesheet entry that month, every
--      expected working day without hours is unpaid, at rate / working_days
--      per day, into unpaid_leave. Expected days = working_days scaled by the
--      share of the month employed. No timesheet at all = no deduction, so
--      staff nobody tracks still get paid in full as before.
--
-- Hourly staff are unchanged: pay is still hours x rate.

alter table payroll_rates add column if not exists working_days numeric not null default 28
  check (working_days > 0 and working_days <= 31);

-- Copied from 020_timesheet.sql (the current version), with pro-rating added
-- and the statutory wage base now net of unpaid leave, as save_payslip does.
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
    ot_pay := round(ts_ot * (case when e.pay_type = 'hourly' then e.rate else 0 end) * rates.ot_normal, 2);
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
