-- DYRB Back Office: company details for printed reports (026)
-- Run in Supabase SQL Editor after 025_prorate.sql. Safe to run again.
--
-- One row: the name, registration number and address printed at the top of
-- every report. Anyone signed in may read it (it goes on what they print);
-- only the owner changes it.

create table if not exists company (
  id int primary key default 1 check (id = 1),
  name text not null default 'DYRB',
  reg_no text not null default '',
  address text not null default '',
  phone text not null default '',
  updated_at timestamptz not null default now()
);
insert into company (id) values (1) on conflict (id) do nothing;

alter table company enable row level security;
drop policy if exists "signed in reads" on company;
create policy "signed in reads" on company for select using (auth.uid() is not null);
drop policy if exists "owner edits" on company;
create policy "owner edits" on company for update
  using (my_role() = 'owner') with check (my_role() = 'owner');
