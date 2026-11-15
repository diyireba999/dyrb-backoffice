-- DYRB Back Office: Packaging & Consumables is a running cost, not cost of sales.
-- Reports and the dashboard treat 5000-5999 as cost of sales, so the account moves
-- from 5100 to 6650 and everything booked to it comes along. Safe to run again.
insert into accounts (code, name, type) values ('6650', 'Packaging & Consumables', 'expense')
on conflict (code) do nothing;
update journal_lines set account = '6650' where account = '5100';
update suppliers set default_account = '6650' where default_account = '5100';
update claims set account = '6650' where account = '5100';
update payment_map set account = '6650' where account = '5100';
update item_category_map set account = '6650' where account = '5100';
update recurring_accruals set account = '6650' where account = '5100';
update sales_settings set discount_account = '6650' where discount_account = '5100';
delete from accounts where code = '5100';
