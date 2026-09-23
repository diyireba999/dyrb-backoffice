-- DYRB Back Office: repair / finish 003_accounting.sql
--
-- Safe to run at any time, as many times as you like. It creates whatever is
-- missing and leaves the rest alone. Use it if part of 003 did not go in
-- (for example when a paste was cut short), then run 004-008 again the same way.

-- ---------- Document numbers ----------
drop function if exists doc_prefix(text);
create function doc_prefix(p_source text) returns text language sql immutable as $$
  select case p_source
    when 'pv' then 'PV' when 'or' then 'OR' when 'transfer' then 'TR'
    when 'pi' then 'PI' when 'sp' then 'SP' when 'claim' then 'CL'
    when 'sales' then 'SL' when 'fiuu' then 'FS' when 'payroll' then 'PR'
    else 'JV' end
$$;

create table if not exists doc_counters (prefix text primary key, last int not null);
alter table doc_counters enable row level security;

alter table journals add column if not exists doc_no text;
alter table journals add column if not exists reference text;
alter table journals add column if not exists supplier_id bigint references suppliers;
do $$ begin
  alter table journals add constraint journals_doc_no_key unique (doc_no);
exception when duplicate_table or duplicate_object then null; end $$;

-- Number any entries that do not have a number yet, oldest first.
with numbered as (
  select id, doc_prefix(source) as p,
         row_number() over (partition by doc_prefix(source) order by date, id)
           + coalesce((select last from doc_counters c where c.prefix = doc_prefix(journals.source)), 0) as n
  from journals where doc_no is null)
update journals j set doc_no = numbered.p || '-' || lpad(numbered.n::text, 6, '0')
from numbered where numbered.id = j.id;

insert into doc_counters (prefix, last)
  select doc_prefix(source), count(*) from journals group by 1
  on conflict (prefix) do update set last = greatest(doc_counters.last, excluded.last);

drop function if exists set_doc_no() cascade;
create function set_doc_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text := doc_prefix(new.source); n int;
begin
  insert into doc_counters values (p, 1)
    on conflict (prefix) do update set last = doc_counters.last + 1
    returning last into n;
  new.doc_no := p || '-' || lpad(n::text, 6, '0');
  return new;
end $$;

drop trigger if exists journals_doc_no on journals;
create trigger journals_doc_no before insert on journals for each row execute function set_doc_no();

-- ---------- post_journal / delete_journal ----------
drop function if exists post_journal(date, text, text, text, text, jsonb, bigint);
drop function if exists post_journal(date, text, text, text, text, jsonb);
create or replace function post_journal(p_date date, p_description text, p_source text, p_ref text,
                             p_attachment text, p_lines jsonb, p_supplier bigint default null,
                             p_reference text default null)
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
  insert into journals (date, description, source, source_ref, attachment, supplier_id, reference)
    values (p_date, p_description, coalesce(p_source, 'manual'), p_ref, p_attachment, p_supplier, nullif(p_reference, ''))
    returning id into j;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select j, l->>'account', coalesce((l->>'debit')::numeric, 0), coalesce((l->>'credit')::numeric, 0), l->>'memo'
    from jsonb_array_elements(p_lines) l;
  return j;
end $$;

drop function if exists delete_journal(bigint) cascade;
create function delete_journal(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare src text;
begin
  select source into src from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src in ('pi', 'sp') then raise exception 'Cancel this from Purchase Invoice / Supplier Payment instead'; end if;
  if not (my_role() = 'owner' or (is_office() and src in ('manual', 'pv', 'or', 'jv', 'transfer'))) then
    raise exception 'Not allowed to delete this entry'; end if;
  delete from journals where id = p_id;
end $$;

-- ---------- Purchase invoices and supplier payments ----------
create table if not exists purchase_invoices (
  id bigint generated always as identity primary key,
  journal_id bigint not null unique references journals,
  supplier_id bigint not null references suppliers,
  invoice_no text,
  date date not null,
  due_date date not null,
  total numeric(12,2) not null check (total > 0)
);

create table if not exists supplier_payments (
  id bigint generated always as identity primary key,
  journal_id bigint not null unique references journals,
  supplier_id bigint not null references suppliers,
  date date not null,
  amount numeric(12,2) not null check (amount > 0)
);

create table if not exists payment_allocations (
  payment_id bigint not null references supplier_payments on delete cascade,
  invoice_id bigint not null references purchase_invoices,
  amount numeric(12,2) not null check (amount > 0),
  primary key (payment_id, invoice_id)
);

alter table purchase_invoices enable row level security;
alter table supplier_payments enable row level security;
alter table payment_allocations enable row level security;
do $$ begin create policy "office reads" on purchase_invoices for select using (is_office());
exception when duplicate_object then null; end $$;
do $$ begin create policy "office reads" on supplier_payments for select using (is_office());
exception when duplicate_object then null; end $$;
do $$ begin create policy "office reads" on payment_allocations for select using (is_office());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on purchase_invoices, supplier_payments, payment_allocations from anon, authenticated;

create or replace view purchase_invoice_status with (security_invoker = true) as
  select pi.id, pi.supplier_id, s.name as supplier, pi.invoice_no, pi.date, pi.due_date, pi.total,
         j.doc_no, j.description,
         coalesce(sum(pa.amount), 0) as paid,
         pi.total - coalesce(sum(pa.amount), 0) as outstanding
  from purchase_invoices pi
  join suppliers s on s.id = pi.supplier_id
  join journals j on j.id = pi.journal_id
  left join payment_allocations pa on pa.invoice_id = pi.id
  group by pi.id, s.name, j.doc_no, j.description;

drop function if exists create_purchase_invoice(bigint,text,date,date,text,jsonb,text) cascade;
create function create_purchase_invoice(p_supplier bigint, p_invoice_no text, p_date date, p_due date,
                                        p_description text, p_lines jsonb, p_attachment text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare total numeric; j bigint; inv bigint;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  if p_due < p_date then raise exception 'Due date cannot be before invoice date'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'amount')::numeric, 0) <= 0) then
    raise exception 'Each line needs an amount'; end if;
  select sum((l->>'amount')::numeric) into total from jsonb_array_elements(p_lines) l;
  if coalesce(total, 0) <= 0 then raise exception 'Invoice total must be more than zero'; end if;
  j := post_journal(p_date, p_description, 'pi', null, p_attachment,
    (select jsonb_agg(jsonb_build_object('account', l->>'account', 'debit', (l->>'amount')::numeric, 'memo', l->>'memo'))
       from jsonb_array_elements(p_lines) l)
    || jsonb_build_array(jsonb_build_object('account', '2000', 'credit', total)),
    p_supplier, p_invoice_no);
  insert into purchase_invoices (journal_id, supplier_id, invoice_no, date, due_date, total)
    values (j, p_supplier, nullif(p_invoice_no, ''), p_date, p_due, total) returning id into inv;
  return inv;
end $$;

drop function if exists pay_supplier(bigint,date,text,text,jsonb) cascade;
create function pay_supplier(p_supplier bigint, p_date date, p_from text, p_reference text, p_allocations jsonb)
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

drop function if exists cancel_purchase_invoice(bigint) cascade;
create function cancel_purchase_invoice(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can cancel'; end if;
  if exists (select 1 from payment_allocations where invoice_id = p_id) then
    raise exception 'Invoice has payments. Cancel the payment first.'; end if;
  delete from purchase_invoices where id = p_id returning journal_id into j;
  delete from journals where id = j;
end $$;

drop function if exists cancel_supplier_payment(bigint) cascade;
create function cancel_supplier_payment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can cancel'; end if;
  delete from supplier_payments where id = p_id returning journal_id into j;
  delete from journals where id = j;
end $$;

-- ---------- Bank reconciliation ----------
alter table journal_lines add column if not exists cleared_on date;

drop function if exists set_cleared(bigint[],date) cascade;
create function set_cleared(p_line_ids bigint[], p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  update journal_lines set cleared_on = p_date where id = any(p_line_ids);
end $$;

-- ---------- Totals for reports ----------
drop function if exists account_totals(date,date) cascade;
create function account_totals(p_from date, p_to date)
returns table (code text, debit numeric, credit numeric)
language sql stable as $$
  select l.account, sum(l.debit), sum(l.credit)
  from journal_lines l join journals j on j.id = l.journal_id
  where (p_from is null or j.date >= p_from) and j.date <= p_to
  group by l.account
$$;

drop function if exists cleared_total(text,date) cascade;
create function cleared_total(p_account text, p_date date) returns numeric
language sql stable as $$
  select coalesce(sum(debit - credit), 0) from journal_lines
  where account = p_account and cleared_on is not null and cleared_on <= p_date
$$;

-- ---------- Supplier balances (from 001, in case that part is missing too) ----------
create or replace view supplier_balances with (security_invoker = true) as
  select s.id, s.name, coalesce(sum(l.credit - l.debit), 0) as owed
  from suppliers s
  left join journals j on j.supplier_id = s.id
  left join journal_lines l on l.journal_id = j.id and l.account = '2000'
  group by s.id, s.name;
