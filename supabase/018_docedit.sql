-- DYRB Back Office: correcting a document (018)
-- Run in Supabase SQL Editor after 017_corkage.sql.
--
-- Until now a wrong entry could only be deleted and retyped. These functions let a
-- document be opened and changed while keeping its number, so PV-000012 stays
-- PV-000012. Nothing here deletes or rewrites data that is already in the books.
--
-- Only documents typed in by hand may be edited this way: manual, pv, or, jv,
-- transfer. A document produced by another screen (daily sales, payroll, a claim,
-- a card settlement, a stock count) is changed on that screen and re-posted, so
-- the record and the ledger never drift apart.

alter table journals add column if not exists updated_at timestamptz;
alter table journals add column if not exists updated_by uuid references auth.users;

-- ---------- Purchase invoice ----------
-- Same rules as create_purchase_invoice, and only while nothing has been paid
-- against it — the same condition cancel_purchase_invoice already enforces.
create or replace function update_purchase_invoice(p_id bigint, p_invoice_no text, p_date date,
                                                   p_due date, p_description text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare inv purchase_invoices; v_total numeric; bad text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select * into inv from purchase_invoices where id = p_id;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if exists (select 1 from payment_allocations where invoice_id = p_id) then
    raise exception 'Invoice has payments. Cancel the payment first.'; end if;
  if p_due < p_date then raise exception 'Due date cannot be before invoice date'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'amount')::numeric, 0) <= 0) then
    raise exception 'Each line needs an amount'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
  select string_agg(distinct l->>'account', ', ') into bad from jsonb_array_elements(p_lines) l
    where l->>'account' in (select cost_account from category_costing);
  if bad is not null then
    raise exception 'Use the stock account instead of % — the cost is booked when the item sells', bad; end if;
  select sum((l->>'amount')::numeric) into v_total from jsonb_array_elements(p_lines) l;
  if coalesce(v_total, 0) <= 0 then raise exception 'Invoice total must be more than zero'; end if;

  delete from journal_lines where journal_id = inv.journal_id;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select inv.journal_id, l->>'account', (l->>'amount')::numeric, 0, l->>'memo'
      from jsonb_array_elements(p_lines) l;
  insert into journal_lines (journal_id, account, debit, credit)
    values (inv.journal_id, '2000', 0, v_total);
  update journals set date = p_date, description = p_description,
         reference = nullif(p_invoice_no, ''), updated_at = now(), updated_by = auth.uid()
   where id = inv.journal_id;
  update purchase_invoices set invoice_no = nullif(p_invoice_no, ''), date = p_date,
         due_date = p_due, total = v_total
   where id = p_id;
end $$;

-- ---------- Supplier payment ----------
-- Allocations are replaced wholesale. The invoice's own allocation is dropped
-- first so the outstanding check measures the invoice without this payment.
create or replace function update_supplier_payment(p_id bigint, p_date date, p_from text,
                                                   p_reference text, p_allocations jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pay supplier_payments; a jsonb; v_total numeric := 0; owing numeric;
begin
  if my_role() not in ('owner', 'accountant', 'manager') then raise exception 'Not allowed'; end if;
  select * into pay from supplier_payments where id = p_id;
  if pay.id is null then raise exception 'Payment not found'; end if;
  if p_from not in ('1000', '1010', '1100', '3000') and not (p_from >= '2500' and p_from < '2600') then
    raise exception 'Pay from cash, petty cash, bank, a director or owner capital'; end if;
  if not exists (select 1 from accounts where code = p_from and active) then
    raise exception 'Account is switched off'; end if;
  if exists (select 1 from journal_lines where journal_id = pay.journal_id and cleared_on is not null) then
    raise exception 'This payment is ticked on the bank reconciliation. Untick it there first.'; end if;

  delete from payment_allocations where payment_id = p_id;
  for a in select * from jsonb_array_elements(p_allocations) loop
    perform 1 from purchase_invoices where id = (a->>'invoice_id')::bigint for update;
    select outstanding into owing from purchase_invoice_status
      where id = (a->>'invoice_id')::bigint and supplier_id = pay.supplier_id;
    if owing is null then raise exception 'Invoice does not belong to this supplier'; end if;
    if (a->>'amount')::numeric > owing then raise exception 'Paying more than owed on an invoice'; end if;
    v_total := v_total + (a->>'amount')::numeric;
  end loop;
  if v_total <= 0 then raise exception 'Enter an amount to pay'; end if;

  insert into payment_allocations (payment_id, invoice_id, amount)
    select p_id, (a2->>'invoice_id')::bigint, (a2->>'amount')::numeric
      from jsonb_array_elements(p_allocations) a2 where (a2->>'amount')::numeric > 0;
  delete from journal_lines where journal_id = pay.journal_id;
  insert into journal_lines (journal_id, account, debit, credit) values
    (pay.journal_id, '2000', v_total, 0),
    (pay.journal_id, p_from, 0, v_total);
  update journals set date = p_date, reference = nullif(p_reference, ''),
         updated_at = now(), updated_by = auth.uid()
   where id = pay.journal_id;
  update supplier_payments set date = p_date, amount = v_total where id = p_id;
end $$;

-- ---------- Replacing a day's sales ----------
-- A day can only be posted once, so correcting one used to mean deleting it and
-- re-uploading as two separate steps. This does both in one transaction: if the
-- new figures are rejected, the old day is still there.
create or replace function replace_sales_day(p_date date, p_sales numeric, p_service numeric,
                                             p_tax numeric, p_rounding numeric, p_payments jsonb,
                                             p_sales_lines jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if my_role() <> 'owner' then
    raise exception 'Only the owner can replace a day that is already posted'; end if;
  if exists (select 1 from journal_lines l join journals j on j.id = l.journal_id
             where j.source = 'sales' and j.source_ref = p_date::text and l.cleared_on is not null) then
    raise exception 'This day is ticked on the bank reconciliation. Untick it there first.'; end if;
  -- The day's cost of sales belongs to the day, and goes with it.
  delete from journals where source = 'cogs' and source_ref = p_date::text;
  delete from journals where source = 'sales' and source_ref = p_date::text;
  return post_sales_day(p_date, p_sales, p_service, p_tax, p_rounding, p_payments, p_sales_lines);
end $$;

-- ---------- A journal touching Suppliers Owed was a dead end ----------
-- update_journal used to reject any 2000 line outright, but JournalEntry lets you
-- post one when a supplier is chosen (post_journal's own rule). Bring update_journal
-- in line: a 2000 line is fine when the journal already has a supplier attached; it
-- is only refused when there is none to attribute it to. The supplier itself is not
-- an edit parameter and is not changed here.
create or replace function update_journal(p_id bigint, p_date date, p_description text,
                                          p_reference text, p_attachment text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare src text; v_supplier bigint;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select source, supplier_id into src, v_supplier from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src not in ('manual', 'pv', 'or', 'jv', 'transfer') then
    raise exception 'This document is changed on the screen that created it, not here'; end if;
  if exists (select 1 from journal_lines where journal_id = p_id and cleared_on is not null) then
    raise exception 'This entry is ticked on the bank reconciliation. Untick it there first.'; end if;
  if jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
  if v_supplier is null and exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' = '2000') then
    raise exception 'Choose which supplier (add them in Suppliers first)'; end if;

  delete from journal_lines where journal_id = p_id;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select p_id, l->>'account', coalesce((l->>'debit')::numeric, 0),
           coalesce((l->>'credit')::numeric, 0), l->>'memo'
    from jsonb_array_elements(p_lines) l;
  update journals
     set date = p_date, description = p_description,
         reference = nullif(p_reference, ''),
         attachment = coalesce(p_attachment, attachment),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;

-- ---------- A reconciled document could not be edited, but could still be deleted ----------
-- Same guard the edit functions above already use, added to the deletion path.
-- Bodies below are copied from where each function currently lives (016_fixes2.sql
-- for delete_journal and cancel_supplier_payment, 003_accounting.sql for
-- cancel_purchase_invoice) with only the bank-reconciliation guard added.

create or replace function delete_journal(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare src text; ref text;
begin
  select source, source_ref into src, ref from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src in ('pi', 'sp') then raise exception 'Cancel this from Purchase Invoice / Supplier Payment instead'; end if;
  if not (my_role() = 'owner' or (is_office() and src in ('manual', 'pv', 'or', 'jv', 'transfer'))) then
    raise exception 'Not allowed to delete this entry'; end if;
  if exists (select 1 from journal_lines where journal_id = p_id and cleared_on is not null) then
    raise exception 'This entry is ticked on the bank reconciliation. Untick it there first.'; end if;
  -- A day's cost of sales belongs to that day's sales; it goes with it.
  if src = 'sales' and ref is not null then
    delete from journals where source = 'cogs' and source_ref = ref;
  end if;
  delete from journals where id = p_id;
end $$;

create or replace function cancel_purchase_invoice(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can cancel'; end if;
  if exists (select 1 from payment_allocations where invoice_id = p_id) then
    raise exception 'Invoice has payments. Cancel the payment first.'; end if;
  select journal_id into j from purchase_invoices where id = p_id;
  if exists (select 1 from journal_lines where journal_id = j and cleared_on is not null) then
    raise exception 'This invoice is ticked on the bank reconciliation. Untick it there first.'; end if;
  delete from purchase_invoices where id = p_id returning journal_id into j;
  delete from journals where id = j;
end $$;

create or replace function cancel_supplier_payment(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can cancel'; end if;
  select journal_id into j from supplier_payments where id = p_id;
  if j is null then raise exception 'Payment not found'; end if;
  if exists (select 1 from journal_lines where journal_id = j and cleared_on is not null) then
    raise exception 'This payment is ticked on the bank reconciliation. Untick it there first.'; end if;
  delete from supplier_payments where id = p_id;
  delete from journals where id = j;
end $$;
