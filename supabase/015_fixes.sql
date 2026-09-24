-- DYRB Back Office: fixes found in the review before going live
-- Run in Supabase SQL Editor after 014_recurring.sql. Safe to run again.

-- Staff could not open their own payslip: the payslip view reads payroll_runs,
-- and only office roles could see that table.
drop policy if exists "office reads" on payroll_runs;
create policy "office reads, staff read runs with their payslip" on payroll_runs for select
  using (is_office() or exists (
    select 1 from payslips p join employees e on e.id = p.employee_id
    where p.run_id = payroll_runs.id and e.profile_id = auth.uid()));

-- A manager could edit someone else's claim (amount, account, even whose claim it
-- is) while approving it: the policy only checked the status of the new row.
drop policy if exists "owner/manager reviews" on claims;
create policy "owner/manager reviews" on claims for update
  using (my_role() = 'owner' or (my_role() = 'manager' and staff_id <> auth.uid()))
  with check ((my_role() = 'owner' or (my_role() = 'manager' and staff_id <> auth.uid()))
              and status in ('approved', 'rejected', 'pending'));

-- Reviewing a claim may set the status and the note. The money, the account, the
-- date and the receipt stay as the person submitted them.
create or replace function claim_review_only() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if my_role() = 'owner' then return new; end if;
  if new.staff_id <> old.staff_id or new.amount <> old.amount or new.account <> old.account
     or new.date <> old.date or new.receipt is distinct from old.receipt then
    raise exception 'A claim can be approved or rejected, not changed. Ask the owner.';
  end if;
  return new;
end $$;
drop trigger if exists claims_review_only on claims;
create trigger claims_review_only before update on claims
  for each row execute function claim_review_only();

-- A claim must be coded to a real expense account.
drop policy if exists "anyone submits own claim" on claims;
create policy "anyone submits own claim" on claims for insert
  with check (staff_id = auth.uid() and status = 'pending'
              and account in (select code from accounts where type = 'expense' and active));

-- Re-splitting a day could write to any account, skipping the usual checks.
create or replace function resplit_sales_day(p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint; accts text[]; was numeric; now_total numeric;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can re-split a day'; end if;

  select id into j from journals where source = 'sales' and source_ref = p_date::text;
  if j is null then raise exception 'There is no daily sales entry for %', p_date; end if;

  select array_agg(distinct code) into accts from (
    select sales_account as code from sales_settings where id = 1
    union select account from item_category_map) a;

  if exists (select 1 from jsonb_array_elements(p_lines) l where not (l->>'account' = any(accts))) then
    raise exception 'That is not one of the sales accounts'; end if;

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

-- Stock counts were posted as ordinary journal entries, which a manager could
-- delete. They get their own document type now (SC), deletable by the owner only.
create or replace function doc_prefix(p_source text) returns text language sql immutable as $$
  select case p_source
    when 'pv' then 'PV' when 'or' then 'OR' when 'transfer' then 'TR'
    when 'pi' then 'PI' when 'sp' then 'SP' when 'claim' then 'CL'
    when 'sales' then 'SL' when 'fiuu' then 'FS' when 'payroll' then 'PR'
    when 'cogs' then 'CS' when 'accrual' then 'AC' when 'stock' then 'SC'
    else 'JV' end
$$;

create or replace function post_stock_count(p_date date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
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

  return post_journal(p_date, 'Stock count ' || to_char(p_date, 'DD/MM/YYYY'), 'stock', p_date::text || '-count',
                      null, lines, null, 'Stock count');
end $$;

-- A temporary table could shadow a real one inside a definer function and defeat
-- every role check. Listing pg_temp last stops that.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

-- If 001 was also cut short, the ledger would have no row security at all.
alter table journals enable row level security;
alter table journal_lines enable row level security;
do $$ begin create policy "office reads" on journals for select using (is_office());
exception when duplicate_object then null; end $$;
do $$ begin create policy "office reads" on journal_lines for select using (is_office());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on journals, journal_lines from anon, authenticated;
