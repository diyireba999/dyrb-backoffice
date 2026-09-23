-- DYRB Back Office: extra Zeoniq item groups
-- Run in Supabase SQL Editor. Safe to run again; it only adds what is missing.
-- Add a line here (or use Sales Settings) whenever a new item-code group appears.

insert into item_category_map (prefix, label, account) values
  ('MT', 'Mocktails', '4010')
on conflict (prefix) do nothing;
