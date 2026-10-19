-- DYRB Back Office: month status for the Today to-do list and the Month-end checklist (032)
-- Run in Supabase SQL Editor after 031_review_fixes.sql. Safe to run again.
--
-- month_status(month) answers, in one call, every question the Today page and the
-- Month-end screen ask: which sales days are missing, is card money still unsettled,
-- where payroll stands, are accruals / stock count / bank reconciliation done.
-- Two small tables hold what only the owner knows: days the bar was shut, and the
-- owner's own marks for a month (supplier invoices all in; month closed).

create table if not exists closed_days (
  day date primary key,
  created_at timestamptz not null default now()
);

create table if not exists month_closes (
  month date primary key,                   -- always the 1st
  invoices_entered boolean not null default false,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table closed_days enable row level security;
alter table month_closes enable row level security;
do $$ begin create policy "office all" on closed_days for all using (is_office()) with check (is_office());
exception when duplicate_object then null; end $$;
do $$ begin create policy "office all" on month_closes for all using (is_office()) with check (is_office());
exception when duplicate_object then null; end $$;

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

  -- Days with no sales entry and not marked closed, up to yesterday.
  select coalesce(jsonb_agg(to_char(g.d, 'YYYY-MM-DD') order by g.d), '[]'::jsonb) into v_missing
    from generate_series(first_day, least(last_day, today - 1), interval '1 day') g(d)
    where not exists (select 1 from journals j where j.source = 'sales' and j.source_ref = to_char(g.d, 'YYYY-MM-DD'))
      and not exists (select 1 from closed_days c where c.day = g.d::date);

  select coalesce(jsonb_agg(to_char(day, 'YYYY-MM-DD') order by day), '[]'::jsonb) into v_closed
    from closed_days where day between first_day and last_day;

  -- Card takings still sitting in 1200. Fiuu pays within a few days, so money taken in
  -- the last three days is normal; money from before that should have landed.
  card_as_at := least(last_day + 7, today - 3);
  if card_as_at >= first_day then
    select coalesce(sum(l.debit - l.credit), 0) into v_card
      from journal_lines l join journals j on j.id = l.journal_id
      where l.account = '1200' and j.date <= card_as_at;
    if v_card < 0 then v_card := 0; end if;
    if v_card > 0 then
      select min(j.date) into v_since
        from journals j join journal_lines l on l.journal_id = j.id
        where j.source = 'sales' and l.account = '1200' and l.debit > 0
          and j.date between first_day and last_day;
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
