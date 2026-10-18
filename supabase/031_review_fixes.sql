-- DYRB Back Office: fixes from the October 2026 review (031)
-- Run in Supabase SQL Editor after 030_accrual_first_day.sql. Safe to run again.
--
-- 1. Staff who leave mid-month and are marked "not working here" still get
--    their last, pro-rated payslip.
-- 2. A claim marked paid by mistake can be put back to approved.
-- 3. Sales that cannot be split by item no longer land in Food Sales; they go
--    to their own account, 4090 Sales (unsplit), until they are re-split.
-- 4. Accounts for the Journal Entries the screens do not cover: cash
--    over/short, depreciation.
-- 5. Objects nothing uses any more.

-- ---------- 1. Leavers stay on the payroll for their last month ----------
-- Copied from 027_payroll_hours.sql (the current version); only the employee
-- filter changed: "active" OR left on or after the first of the month.
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
  for e in select * from employees where (active or leave_date >= first_day)
                                     and (join_date is null or join_date <= last_day)
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

-- ---------- 2. Undo a paid claim ----------
-- The mirror of pay_claim: the payment entry goes, the claim is approved again
-- and can be paid properly. Same bank-reconciliation guard as every other undo.
create or replace function unpay_claim(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can undo a paid claim'; end if;
  select * into c from claims where id = p_id for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status is distinct from 'paid' then raise exception 'This claim is not marked as paid'; end if;
  if exists (select 1 from journal_lines where journal_id = c.paid_journal_id and cleared_on is not null) then
    raise exception 'This payment is ticked on the bank reconciliation. Untick it there first.'; end if;
  update claims set status = 'approved', paid_journal_id = null where id = p_id;
  if c.paid_journal_id is not null then delete from journals where id = c.paid_journal_id; end if;
end $$;

-- ---------- 3. Unsplit sales get their own account ----------
-- A day posted without the product file, or with an item code nobody has
-- mapped yet, used to go to 4000 Food Sales and skew the food margin. It now
-- sits in 4090, still inside the 4000-4099 sales range every report uses, and
-- is moved to food / beverage / liquor by Re-split on the Upload screen.
insert into accounts (code, name, type) values
  ('4090', 'Sales (unsplit)', 'income')
on conflict (code) do nothing;
update sales_settings set sales_account = '4090' where id = 1 and sales_account = '4000';

-- ---------- 4. Accounts for the Journal Entries no screen covers ----------
insert into accounts (code, name, type) values
  ('1590', 'Accumulated Depreciation', 'asset'),
  ('6910', 'Cash Over / Short', 'expense'),
  ('6950', 'Depreciation', 'expense')
on conflict (code) do nothing;

-- ---------- 5. Nothing reads these any more ----------
-- timesheet_months fed create_payroll_run until 025 read timesheets directly;
-- delete_payslip was never wired to a screen (Re-run rebuilds the whole draft).
drop view if exists timesheet_months;
drop function if exists delete_payslip(bigint);
