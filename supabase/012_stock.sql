-- DYRB Back Office: stock and cost of sales (per item)
-- Run in Supabase SQL Editor after 011_resplit.sql.
--
-- How it works:
--   Purchase Invoice   beer, food -> stock accounts (1400/1410/1420), an asset
--   Daily sales        quantity sold x cost per unit -> cost accounts (5000/5010/5020)
--   Stock count        corrects wastage, free pours and breakage once in a while

insert into accounts (code, name, type) values
  ('1400', 'Food Stock', 'asset'),
  ('1410', 'Beverage Stock', 'asset'),
  ('1420', 'Liquor Stock', 'asset')
on conflict (code) do nothing;

-- Which cost and stock account belongs to each sales account.
create table category_costing (
  sales_account text primary key references accounts(code),
  cost_account text not null references accounts(code),
  stock_account text not null references accounts(code)
);
insert into category_costing (sales_account, cost_account, stock_account) values
  ('4000', '5000', '1400'),
  ('4010', '5010', '1410'),
  ('4020', '5020', '1420')
on conflict (sales_account) do nothing;

alter table category_costing enable row level security;
create policy "office reads" on category_costing for select using (is_office());
create policy "owner or accountant edits" on category_costing for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- Cost per unit for each Zeoniq item. Rows appear by themselves when a Product
-- Sales file is uploaded; you fill in the cost.
create table item_costs (
  code text primary key,
  name text not null default '',
  unit_cost numeric(12,4) not null default 0,
  last_seen date,
  updated_at timestamptz not null default now()
);

alter table item_costs enable row level security;
create policy "office reads" on item_costs for select using (is_office());
create policy "owner or accountant edits" on item_costs for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- Remember the items seen in an upload, without touching costs already set.
create function note_items(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  insert into item_costs (code, name, last_seen)
    select upper(i->>'code'), coalesce(i->>'name', ''), (i->>'date')::date
    from jsonb_array_elements(p_items) i
  on conflict (code) do update set
    name = case when item_costs.name = '' then excluded.name else item_costs.name end,
    last_seen = greatest(coalesce(item_costs.last_seen, excluded.last_seen), excluded.last_seen);
end $$;

-- Cost of sales for one day. p_lines: [{"sales_account":"4020","amount":123.45}, ...]
-- Posting again for the same day replaces the earlier entry.
create function post_cogs_day(p_date date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare old bigint; lines jsonb := '[]'::jsonb; l jsonb; c category_costing; total numeric := 0;
begin
  if my_role() not in ('owner', 'accountant', 'manager') then raise exception 'Not allowed'; end if;

  select id into old from journals where source = 'cogs' and source_ref = p_date::text;
  if old is not null then delete from journals where id = old; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'amount')::numeric, 0) > 0 then
      select * into c from category_costing where sales_account = l->>'sales_account';
      if c is null then raise exception 'No cost account set up for sales account %', l->>'sales_account'; end if;
      total := total + (l->>'amount')::numeric;
      lines := lines || jsonb_build_array(
        jsonb_build_object('account', c.cost_account, 'debit', (l->>'amount')::numeric, 'memo', 'Cost of sales'),
        jsonb_build_object('account', c.stock_account, 'credit', (l->>'amount')::numeric, 'memo', 'Stock used'));
    end if;
  end loop;
  if total <= 0 then return null; end if;

  return post_journal(p_date, 'Cost of sales ' || to_char(p_date, 'DD/MM/YYYY'), 'cogs', p_date::text, null, lines);
end $$;

-- Stock count: type what is on the shelf, the difference goes to cost.
-- p_lines: [{"stock_account":"1420","counted":5300.00}, ...]
create function post_stock_count(p_date date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare l jsonb; c category_costing; book numeric; diff numeric; lines jsonb := '[]'::jsonb; any_line boolean := false;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can post a stock count'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into c from category_costing where stock_account = l->>'stock_account';
    if c is null then raise exception 'Unknown stock account %', l->>'stock_account'; end if;
    select coalesce(sum(jl.debit - jl.credit), 0) into book
      from journal_lines jl join journals j on j.id = jl.journal_id
      where jl.account = c.stock_account and j.date <= p_date;
    diff := round((l->>'counted')::numeric - book, 2);
    if diff <> 0 then
      any_line := true;
      lines := lines || jsonb_build_array(
        jsonb_build_object('account', c.stock_account, 'memo', 'Stock count',
          (case when diff > 0 then 'debit' else 'credit' end), abs(diff)),
        jsonb_build_object('account', c.cost_account, 'memo', 'Stock count adjustment',
          (case when diff > 0 then 'credit' else 'debit' end), abs(diff)));
    end if;
  end loop;
  if not any_line then return null; end if;

  return post_journal(p_date, 'Stock count ' || to_char(p_date, 'DD/MM/YYYY'), 'jv', null, null, lines,
                      null, 'Stock count');
end $$;
