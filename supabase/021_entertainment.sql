-- DYRB Back Office: director / manager entertainment (021)
-- Run in Supabase SQL Editor after 020_timesheet.sql.
--
-- Zeoniq now has DIRECTOR and MANAGER payment types: a director or manager
-- orders for a customer they are entertaining and nobody pays. The bill is
-- still a sale, but the "payment" side is an expense, not money in.
--
-- Entertainment gets its own account instead of sharing 6500 Marketing, because
-- only half of it is tax-deductible (ITA s39(1)(l)) and the tax computation
-- needs the figure on its own. ENT moves there too; days already posted keep
-- their old lines.

insert into accounts (code, name, type) values
  ('6510', 'Entertainment', 'expense')
on conflict (code) do nothing;

insert into payment_map (code, label, account) values
  ('DIRECTOR', 'Director entertainment (on the house)', '6510'),
  ('MANAGER', 'Manager entertainment (on the house)', '6510'),
  ('ENT', 'Entertainment (on the house)', '6510')
on conflict (code) do update set label = excluded.label, account = excluded.account;
