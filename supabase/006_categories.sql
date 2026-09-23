-- DYRB Back Office: split daily sales into food, beverage and liquor
-- Run in Supabase SQL Editor after 005_sales.sql.
--
-- Zeoniq item codes start with a letter group (AC01, BB02C, NA05...). Each group
-- is pointed at a sales account here, and the Product Sales Listing export is
-- then split by those groups when a day is posted.

create table item_category_map (
  prefix text primary key,               -- letters at the start of the item code
  label text not null,
  account text not null references accounts(code)
);

insert into item_category_map (prefix, label, account) values
  ('AC', 'Draught beer', '4020'),
  ('DC', 'Draught beer (happy hour)', '4020'),
  ('BB', 'Bottled beer', '4020'),
  ('CT', 'Cocktails', '4020'),
  ('OP', 'Open drink', '4020'),
  ('NA', 'Non-alcoholic drinks', '4010'),
  ('MT', 'Mocktails', '4010'),
  ('F', 'Food', '4000'),
  ('T', 'Tidbits', '4000'),
  ('XS', 'Snacks', '4000');

alter table item_category_map enable row level security;
create policy "office reads" on item_category_map for select using (is_office());
create policy "owner or accountant edits" on item_category_map for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));
