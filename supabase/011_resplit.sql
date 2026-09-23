-- DYRB Back Office: re-split a day that was already posted
-- Run in Supabase SQL Editor after 006_categories.sql.
--
-- A day posted as one sales line can be split into food / beverage / liquor
-- later, without deleting anything. Only the sales lines change: the payments,
-- service charge, SST and rounding stay exactly as they were.

create or replace function resplit_sales_day(p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare j bigint; accts text[]; was numeric; now_total numeric;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can re-split a day'; end if;

  select id into j from journals where source = 'sales' and source_ref = p_date::text;
  if j is null then raise exception 'There is no daily sales entry for %', p_date; end if;

  -- Every account sales can land in: the default one plus the item groups.
  select array_agg(distinct code) into accts from (
    select sales_account as code from sales_settings where id = 1
    union select account from item_category_map) a;

  select coalesce(sum(credit - debit), 0) into was from journal_lines
    where journal_id = j and account = any(accts);
  select coalesce(sum((l->>'amount')::numeric), 0) into now_total from jsonb_array_elements(p_lines) l;
  if round(was, 2) <> round(now_total, 2) then
    raise exception 'The split (%) does not match the sales already posted for that day (%)', now_total, was; end if;

  delete from journal_lines where journal_id = j and account = any(accts);
  insert into journal_lines (journal_id, account, credit, memo)
    select j, l->>'account', (l->>'amount')::numeric, coalesce(l->>'memo', 'Sales')
    from jsonb_array_elements(p_lines) l where (l->>'amount')::numeric <> 0;
end $$;
