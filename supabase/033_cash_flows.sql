-- DYRB Back Office: cash flow report (033)
-- Run in Supabase SQL Editor after 032_month_status.sql. Safe to run again.
--
-- Where the money came from and where it went, for a period. Direct method: in
-- every entry that touches cash or bank (1000, 1010, 1100), the other lines say
-- what the money was for. A credit on that other side means money came in
-- (sales, card settlement, capital); a debit means it went out (rent, suppliers,
-- wages). Every entry balances, so these other-side amounts add up exactly to
-- the change in cash. A move between cash and bank has no other side and drops out.
-- A bill the director paid from their own pocket (credit 25xx Owed to Director)
-- counts too: the bill shows as money out and the same amount as money in from
-- the director, so the shareholder sees the spend; the cash total is unchanged.
-- Same access as account_totals after 024: office and investors, totals only.

create or replace function cash_flows(p_from date, p_to date)
returns table (code text, amount numeric)
language sql stable security definer set search_path = public as $$
  select l.account, sum(l.credit - l.debit)
  from journal_lines l join journals j on j.id = l.journal_id
  where j.date >= p_from and j.date <= p_to
    and l.account not in ('1000', '1010', '1100')
    and exists (select 1 from journal_lines m where m.journal_id = j.id
                and (m.account in ('1000', '1010', '1100') or m.account between '2500' and '2599'))
    and (is_office() or my_role()::text = 'investor')  -- not is_investor(): 024 may not have been run
  group by l.account
$$;
