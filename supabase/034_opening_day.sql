-- DYRB Back Office: no "sales not uploaded" before the bar opened (034)
-- Run in Supabase SQL Editor after 033_cash_flows.sql. Safe to run again.
--
-- month_status() listed every day of the opening month before the first sales
-- upload as missing, so the Today list nagged about days the bar was shut.
-- Days before the first sales entry in the books are now left out. The rest of
-- the function is unchanged from 032.

create or replace function month_status(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare first_day date := date_trunc('month', p_month)::date;
        last_day date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
        today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
        card_as_at date;
        v_missing jsonb; v_closed jsonb; v_card numeric := 0; v_since date;
        v_ts int; v_staff int; v_run payroll_runs; v_bank int; v_close month_closes;
begin
  if not is_office() then raise exception 'Not allowed'; end if;

  -- Days with no sales entry and not marked closed, up to yesterday. Days before
  -- the first sales upload ever do not count: the bar had not opened yet.
  select coalesce(jsonb_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d), '[]'::jsonb) into v_missing
    from generate_series(first_day, least(last_day, today - 1), interval '1 day') g(d)
    where g.d >= coalesce((select min(source_ref::date) from journals where source = 'sales'), g.d)
      and not exists (select 1 from journals j where j.source = 'sales' and j.source_ref = to_char(g.d, 'YYYY-MM-DD'))
      and not exists (select 1 from closed_days c where c.day = g.d::date);

  select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]'::jsonb) into v_closed
    from closed_days where day between first_day and last_day;

  -- Card takings still sitting in 1200: takings old enough to have landed (dated on or
  -- before card_as_at; Fiuu pays within a few days, so the last three days are normal),
  -- less every payout booked so far. Payouts are not cut off at card_as_at, because they
  -- land a few days after the takings they settle.
  card_as_at := least(last_day + 7, today - 3);
  if card_as_at >= first_day then
    select coalesce(sum(case when j.date <= card_as_at then l.debit else 0 end) - sum(l.credit), 0) into v_card
      from journal_lines l join journals j on j.id = l.journal_id
      where l.account = '1200';
    if v_card < 0 then v_card := 0; end if;
    if v_card > 0 then
      -- The earliest day whose takings are still uncovered: walking back from the cutoff,
      -- the first day at which the cumulative takings cover the outstanding amount. This
      -- can be a date in an earlier month.
      select max(d) into v_since from (
        select j.date as d, sum(l.debit) over (order by j.date desc) as tail
          from journal_lines l join journals j on j.id = l.journal_id
          where l.account = '1200' and l.debit > 0 and j.date <= card_as_at) t
       where t.tail >= v_card;
    end if;
  end if;

  select count(*) into v_ts from timesheets where work_date between first_day and last_day;
  select count(*) into v_staff from employees where active;
  select * into v_run from payroll_runs where month = first_day;
  select count(*) into v_bank
    from journal_lines l join journals j on j.id = l.journal_id
    where l.account = '1100' and l.cleared_on is null and j.date <= last_day;
  select * into v_close from month_closes where month = first_day;

  return jsonb_build_object(
    'month', to_char(first_day, 'YYYY-MM-DD'),
    'days_missing', v_missing,
    'days_closed', v_closed,
    'card_unsettled', round(v_card, 2),
    'card_since', to_char(v_since, 'YYYY-MM-DD'),
    'timesheet_rows', v_ts,
    'active_staff', v_staff,
    'payroll', jsonb_build_object(
      'status', case when v_run.id is null then 'none'
                     when v_run.status = 'draft' then 'draft'
                     when v_run.paid_on is null then 'approved'
                     else 'paid' end,
      'run_id', v_run.id),
    'accruals_posted', exists (select 1 from journals where source = 'accrual' and source_ref = to_char(first_day, 'YYYY-MM-DD')),
    'stock_count_posted', exists (select 1 from journals where source = 'stock' and date between first_day and last_day),
    'bank_uncleared', v_bank,
    'invoices_entered', coalesce(v_close.invoices_entered, false),
    'closed_at', v_close.closed_at);
end $$;
