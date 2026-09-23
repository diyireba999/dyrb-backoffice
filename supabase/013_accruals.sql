-- DYRB Back Office: accruals
-- Run in Supabase SQL Editor after 001.
--
-- For a cost that belongs to this month when no bill has arrived yet: rent not
-- invoiced, an estimated electricity bill, an audit fee to come.
--   Journal Entry   Dr 6100 Rent            Cr 2600 Accrued Expenses
--   When the bill arrives / is paid:
--   Payment Voucher What for 2600 Accrued Expenses, Paid from Bank
-- If the real bill differs from the estimate, the few ringgit left in 2600 can
-- be cleared with another Journal Entry against the same expense account.

insert into accounts (code, name, type) values
  ('2600', 'Accrued Expenses', 'liability')
on conflict (code) do nothing;
