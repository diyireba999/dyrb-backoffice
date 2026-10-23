-- DYRB Back Office: cash flow report (033)
-- Run in Supabase SQL Editor after 032_month_status.sql. Safe to run again.
--
-- Where the money came from and where it went, for a period. Direct method: in
-- every entry that touches cash or bank (1000, 1010, 1100), the other lines say
-- what the money was for. A credit on that other side means money came in
-- (sales, card settlement, capital); a debit means it went out (rent, suppliers,
-- wages). Every entry balances, so these other-side amounts add up exactly to
-- the change in cash. A move between cash and bank has no other side and drops out.
-- Same access as account_totals: office and investors, totals only.

create or replace function cash_flows(p_from date, p_to date)
returns table (code text, amount numeric)
language sql stable security definer set search_path = public as $$
  select l.account, sum(l.credit - l.debit)
  from journal_lines l join journals j on j.id = l.journal_id
  where j.date >= p_from and j.date <= p_to
    and l.account not in ('1000', '1010', '1100')
    and exists (select 1 from journal_lines m where m.journal_id = j.id and m.account in ('1000', '1010', '1100'))
    and (is_office() or is_investor())
  group by l.account
$$;
