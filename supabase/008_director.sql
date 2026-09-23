-- DYRB Back Office: director's account
-- Run in Supabase SQL Editor after 001-007.
--
-- When a director pays a bill with their own money, the business owes them back.
-- That sits here as a liability, not as capital.
-- For a second director, add 2510, 2520... in Chart of Accounts (type: liability).

insert into accounts (code, name, type) values
  ('2500', 'Owed to Director', 'liability')
on conflict (code) do nothing;

-- A payment can now also come out of a director's own pocket (2500-2599).
create or replace function pay_supplier(p_supplier bigint, p_date date, p_from text, p_reference text, p_allocations jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare a jsonb; total numeric := 0; owing numeric; j bigint; pay bigint; who text;
begin
  if my_role() not in ('owner', 'accountant', 'manager') then raise exception 'Not allowed'; end if;
  if p_from not in ('1000', '1010', '1100', '3000') and not (p_from >= '2500' and p_from < '2600') then
    raise exception 'Pay from cash, petty cash, bank, a director or owner capital'; end if;
  for a in select * from jsonb_array_elements(p_allocations) loop
    perform 1 from purchase_invoices where id = (a->>'invoice_id')::bigint for update;
    select outstanding into owing from purchase_invoice_status
      where id = (a->>'invoice_id')::bigint and supplier_id = p_supplier;
    if owing is null then raise exception 'Invoice does not belong to this supplier'; end if;
    if (a->>'amount')::numeric > owing then raise exception 'Paying more than owed on an invoice'; end if;
    total := total + (a->>'amount')::numeric;
  end loop;
  if total <= 0 then raise exception 'Enter an amount to pay'; end if;
  select name into who from suppliers where id = p_supplier;
  j := post_journal(p_date, 'Payment to ' || who, 'sp', null, null,
    jsonb_build_array(jsonb_build_object('account', '2000', 'debit', total),
                      jsonb_build_object('account', p_from, 'credit', total)),
    p_supplier, p_reference);
  insert into supplier_payments (journal_id, supplier_id, date, amount) values (j, p_supplier, p_date, total)
    returning id into pay;
  insert into payment_allocations (payment_id, invoice_id, amount)
    select pay, (a2->>'invoice_id')::bigint, (a2->>'amount')::numeric
    from jsonb_array_elements(p_allocations) a2 where (a2->>'amount')::numeric > 0;
  return pay;
end $$;

-- A staff claim can also be settled by a director paying cash out of their own pocket.
create or replace function pay_claim(p_id bigint, p_from text, p_date date) returns bigint
language plpgsql security definer set search_path = public as $$
declare c claims; who text; j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can pay claims'; end if;
  select * into c from claims where id = p_id for update;
  if p_from not in ('1000', '1010', '1100') and not (p_from >= '2500' and p_from < '2600') then
    raise exception 'Pay from cash, petty cash, bank or a director'; end if;
  if c.status is distinct from 'approved' then raise exception 'Claim must be approved first'; end if;
  select full_name into who from profiles where id = c.staff_id;
  j := post_journal(p_date, 'Claim: ' || who || ' – ' || c.description, 'claim', p_id::text, c.receipt,
    jsonb_build_array(
      jsonb_build_object('account', c.account, 'debit', c.amount),
      jsonb_build_object('account', p_from, 'credit', c.amount)));
  update claims set status = 'paid', paid_journal_id = j where id = p_id;
  return j;
end $$;
