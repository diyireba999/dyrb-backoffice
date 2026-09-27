-- DYRB Back Office: investor role (024)
-- Run in Supabase SQL Editor after 023_disable_login.sql. Safe to run again.
--
-- An investor sees the dashboard and the three summary reports (Profit & Loss,
-- Balance Sheet, Trial Balance) and nothing else: no documents, ledgers,
-- suppliers, claims or payroll. They get account totals, never the journal
-- lines behind them, so descriptions like whose salary it was stay hidden.
--
-- 'investor' is compared as text below: Postgres refuses a new enum value as a
-- literal in the same transaction that adds it.

alter type app_role add value if not exists 'investor';

create or replace function is_investor() returns boolean
language sql stable as $$ select my_role()::text = 'investor' $$;

-- The account list (names and codes) for the reports.
drop policy if exists "investor reads" on accounts;
create policy "investor reads" on accounts for select using (is_investor());

-- Totals per account for a period. Runs as its owner so it can add up journal
-- lines the investor cannot read; only office and investors get anything back.
create or replace function account_totals(p_from date, p_to date)
returns table (code text, debit numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select l.account, sum(l.debit), sum(l.credit)
  from journal_lines l join journals j on j.id = l.journal_id
  where (p_from is null or j.date >= p_from) and j.date <= p_to
    and (is_office() or is_investor())
  group by l.account
$$;

-- Daily totals per account (the dashboard's sales chart). Same idea: the view
-- reads as its owner and filters by role itself.
create or replace view account_balances with (security_invoker = false) as
  select a.code, a.name, a.type, j.date,
         sum(l.debit) as debit, sum(l.credit) as credit
  from journal_lines l
  join journals j on j.id = l.journal_id
  join accounts a on a.code = l.account
  where is_office() or is_investor()
  group by a.code, a.name, a.type, j.date;
