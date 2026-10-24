-- DYRB Back Office: cash flow report (033)
-- Run in Supabase SQL Editor after 032_month_status.sql. Safe to run again.
--
-- The Cash Flow report is built in the app from account_totals(): profit for
-- the period, then the movement on every other balance (stock, equipment,
-- card money to be settled, suppliers, accruals, director), which by double
-- entry adds up to the change in cash and bank. An earlier version of this
-- file created cash_flows(); it is no longer used and is removed here.

drop function if exists cash_flows(date, date);
