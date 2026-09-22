-- DYRB Back Office: core schema (Phase 1 + 2)
-- Run once in Supabase Dashboard > SQL Editor.

-- ---------- Users & roles ----------
create type app_role as enum ('owner', 'manager', 'accountant', 'staff');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role app_role not null default 'staff',
  created_at timestamptz not null default now()
);

-- New sign-ups become 'staff'. Owner promotes them in the Users screen.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function is_office() returns boolean
language sql stable as $$ select my_role() in ('owner', 'manager', 'accountant') $$;

alter table profiles enable row level security;
create policy "read own or office reads all" on profiles for select
  using (id = auth.uid() or is_office());
create policy "owner edits" on profiles for update
  using (my_role() = 'owner');

-- ---------- Chart of accounts ----------
create type account_type as enum ('asset', 'liability', 'equity', 'income', 'expense');

create table accounts (
  code text primary key,
  name text not null,
  type account_type not null,
  active boolean not null default true
);

insert into accounts (code, name, type) values
  ('1000', 'Cash in Drawer', 'asset'),
  ('1010', 'Petty Cash', 'asset'),
  ('1100', 'Bank - Current Account', 'asset'),
  ('1200', 'Fiuu Card (to be settled)', 'asset'),
  ('1210', 'E-Wallet (to be settled)', 'asset'),
  ('1300', 'Deposits Paid (rent, utilities)', 'asset'),
  ('1500', 'Kitchen & Bar Equipment', 'asset'),
  ('1510', 'Furniture & Renovation', 'asset'),
  ('2000', 'Suppliers Owed', 'liability'),
  ('2100', 'SST Payable', 'liability'),
  ('2200', 'Service Charge Owed to Staff', 'liability'),
  ('2300', 'Salaries Payable', 'liability'),
  ('2310', 'EPF Payable', 'liability'),
  ('2320', 'SOCSO Payable', 'liability'),
  ('2330', 'EIS Payable', 'liability'),
  ('2340', 'PCB (Income Tax) Payable', 'liability'),
  ('2400', 'Staff Claims Payable', 'liability'),
  ('3000', 'Owner Capital', 'equity'),
  ('3100', 'Owner Drawings', 'equity'),
  ('3200', 'Retained Profit', 'equity'),
  ('4000', 'Food Sales', 'income'),
  ('4010', 'Beverage Sales', 'income'),
  ('4020', 'Liquor Sales', 'income'),
  ('4100', 'Service Charge Collected', 'income'),
  ('4900', 'Other Income', 'income'),
  ('5000', 'Food Cost', 'expense'),
  ('5010', 'Beverage Cost', 'expense'),
  ('5020', 'Liquor Cost', 'expense'),
  ('5100', 'Packaging & Consumables', 'expense'),
  ('6000', 'Salaries & Wages', 'expense'),
  ('6010', 'EPF - Employer', 'expense'),
  ('6020', 'SOCSO - Employer', 'expense'),
  ('6030', 'EIS - Employer', 'expense'),
  ('6040', 'Staff Meals & Welfare', 'expense'),
  ('6100', 'Rent', 'expense'),
  ('6110', 'Electricity & Water', 'expense'),
  ('6120', 'Internet & Phone', 'expense'),
  ('6200', 'Card & E-Wallet Fees', 'expense'),
  ('6210', 'Bank Charges', 'expense'),
  ('6300', 'Licences (liquor, premise, signboard)', 'expense'),
  ('6400', 'Repairs & Maintenance', 'expense'),
  ('6500', 'Marketing & Promotion', 'expense'),
  ('6600', 'Cleaning & Pest Control', 'expense'),
  ('6700', 'POS & Software Subscriptions', 'expense'),
  ('6800', 'Transport & Delivery', 'expense'),
  ('6900', 'Other Expenses', 'expense');

alter table accounts enable row level security;
create policy "office reads" on accounts for select using (is_office());
create policy "owner/accountant edits" on accounts for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- ---------- Suppliers ----------
create table suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  phone text,
  default_account text references accounts(code)
);
alter table suppliers enable row level security;
create policy "office all" on suppliers for all using (is_office()) with check (is_office());

-- ---------- Journal (double entry) ----------
create table journals (
  id bigint generated always as identity primary key,
  date date not null,
  description text not null,
  source text not null default 'manual',  -- manual, sales, fiuu, claim, payroll
  source_ref text,                        -- e.g. sales date, claim id
  attachment text,                        -- storage path of receipt photo
  supplier_id bigint references suppliers, -- required when the entry touches Suppliers Owed
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  unique (source, source_ref)             -- stops the same sales day / claim being posted twice
);

create table journal_lines (
  id bigint generated always as identity primary key,
  journal_id bigint not null references journals on delete cascade,
  account text not null references accounts(code),
  debit numeric(12,2) not null default 0 check (debit >= 0),
  credit numeric(12,2) not null default 0 check (credit >= 0),
  memo text,
  check ((debit = 0) <> (credit = 0))   -- exactly one side filled
);
create index on journal_lines (journal_id);
create index on journal_lines (account);
create index on journals (date);

-- Every journal must balance. Checked at commit so lines can be inserted one by one.
create function check_journal_balanced() returns trigger
language plpgsql as $$
declare j bigint := coalesce(new.journal_id, old.journal_id);
begin
  if exists (select 1 from journals where id = j) and
     (select coalesce(sum(debit - credit), 0) from journal_lines where journal_id = j) <> 0 then
    raise exception 'Entry % does not balance (debits must equal credits)', j;
  end if;
  return null;
end $$;

create constraint trigger journal_balanced after insert or update or delete on journal_lines
  deferrable initially deferred for each row execute function check_journal_balanced();

alter table journals enable row level security;
alter table journal_lines enable row level security;
create policy "office reads" on journals for select using (is_office());
create policy "office reads" on journal_lines for select using (is_office());
-- No direct writes: entries only change through post_journal / delete_journal below,
-- so nobody can edit amounts on a posted entry or create an empty one.
revoke insert, update, delete on journals, journal_lines from anon, authenticated;

-- Post a whole entry in one call (one transaction):
-- select post_journal('2026-09-22', 'TNB bill', 'manual', null, null,
--   '[{"account":"6110","debit":350},{"account":"1100","credit":350}]');
create function post_journal(p_date date, p_description text, p_source text, p_ref text,
                             p_attachment text, p_lines jsonb, p_supplier bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare j bigint;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  if jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
  if p_supplier is null and exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' = '2000') then
    raise exception 'Choose which supplier (add them in Suppliers first)'; end if;
  insert into journals (date, description, source, source_ref, attachment, supplier_id)
    values (p_date, p_description, coalesce(p_source, 'manual'), p_ref, p_attachment, p_supplier) returning id into j;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select j, l->>'account', coalesce((l->>'debit')::numeric, 0), coalesce((l->>'credit')::numeric, 0), l->>'memo'
    from jsonb_array_elements(p_lines) l;
  return j;
end $$;

-- Office staff may delete their manual entries; entries made by sales upload, claims
-- or payroll can only be removed by the owner (claims/payroll are also protected by links).
create function delete_journal(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare src text;
begin
  select source into src from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if not (my_role() = 'owner' or (is_office() and src = 'manual')) then
    raise exception 'Not allowed to delete this entry'; end if;
  delete from journals where id = p_id;
end $$;

-- Balance per account up to a date (for reports and home screen).
create view account_balances with (security_invoker = true) as
  select a.code, a.name, a.type, j.date,
         sum(l.debit) as debit, sum(l.credit) as credit
  from journal_lines l
  join journals j on j.id = l.journal_id
  join accounts a on a.code = l.account
  group by a.code, a.name, a.type, j.date;

-- How much we owe each supplier right now.
create view supplier_balances with (security_invoker = true) as
  select s.id, s.name, coalesce(sum(l.credit - l.debit), 0) as owed
  from suppliers s
  left join journals j on j.supplier_id = s.id
  left join journal_lines l on l.journal_id = j.id and l.account = '2000'
  group by s.id, s.name;

-- ---------- Receipt photos ----------
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
create policy "office reads receipts" on storage.objects for select
  using (bucket_id = 'receipts' and (is_office() or owner = auth.uid()));
create policy "logged-in uploads receipts" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid() is not null);
