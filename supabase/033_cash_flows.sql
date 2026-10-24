-- DYRB Back Office: cash flow report (033)
-- Run in Supabase SQL Editor after 032_month_status.sql. Safe to run again.
--
-- Money in and money out for a period. The business pays and gets paid through
-- cash, bank, Fiuu card and e-wallet balances still to be settled, and the
-- director's pocket (25xx Owed to Director). In every entry that touches one of
-- those, the other lines say what the money was for: a credit there is money in
-- (sales, service charge), a debit is money out (rent, suppliers, wages, stock).
-- Every entry balances, so these add up exactly to the change in those balances.
-- Moves between them (cash banked in, Fiuu paying out, repaying the director)
-- have no other side and drop out.
-- Same access as account_totals after 024: office and investors, totals only.

create or replace function cash_flows(p_from date, p_to date)
returns table (code text, amount numeric)
language sql stable security definer set search_path = public as $$
  with money as (
    select code from accounts
    where code in ('1000', '1010', '1100', '1200', '1210') or code between '2500' and '2599'
  )
  select l.account, sum(l.credit - l.debit)
  from journal_lines l join journals j on j.id = l.journal_id
  where j.date >= p_from and j.date <= p_to
    and l.account not in (select code from money)
    and exists (select 1 from journal_lines m where m.journal_id = j.id and m.account in (select code from money))
    and (is_office() or my_role()::text = 'investor')  -- not is_investor(): 024 may not have been run
  group by l.account
$$;
