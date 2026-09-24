-- DYRB Back Office: corkage / open items
-- Run in Supabase SQL Editor after 012_stock.sql.
--
-- Open Drink and Open Food are corkage: money with no stock behind it. Keeping
-- them out of liquor sales means the drink margin shows what the bar really makes.
-- There is deliberately no cost or stock account for corkage.

insert into accounts (code, name, type) values
  ('4030', 'Corkage & Open Items', 'income')
on conflict (code) do nothing;

insert into item_category_map (prefix, label, account) values
  ('OP', 'Corkage / open items', '4030')
on conflict (prefix) do update set account = '4030', label = 'Corkage / open items';
