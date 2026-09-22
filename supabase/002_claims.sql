-- DYRB Back Office: staff claims (Phase 4)
-- Run in Supabase SQL Editor after 001_core.sql.

-- Staff need expense category names for the claim form. Names are not sensitive.
drop policy "office reads" on accounts;
create policy "logged-in reads" on accounts for select using (auth.uid() is not null);

create type claim_status as enum ('pending', 'approved', 'rejected', 'paid');

create table claims (
  id bigint generated always as identity primary key,
  staff_id uuid not null references profiles default auth.uid(),
  date date not null,
  account text not null references accounts(code),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  receipt text,
  status claim_status not null default 'pending',
  review_note text,
  reviewed_by uuid references profiles,
  paid_journal_id bigint references journals,
  created_at timestamptz not null default now()
);
create index on claims (status);
create index on claims (staff_id);

alter table claims enable row level security;
create policy "see own or office sees all" on claims for select
  using (staff_id = auth.uid() or is_office());
create policy "anyone submits own claim" on claims for insert
  with check (staff_id = auth.uid() and status = 'pending');
create policy "delete own pending" on claims for delete
  using (staff_id = auth.uid() and status = 'pending');
-- Manager cannot approve own claim; owner can.
create policy "owner/manager reviews" on claims for update
  using (my_role() = 'owner' or (my_role() = 'manager' and staff_id <> auth.uid()))
  with check (status in ('approved', 'rejected', 'pending'));

-- Pay an approved claim: books the expense and marks it paid in one go.
-- ponytail: expense is booked on payment date (cash basis); add accrual via 2400 if month-end cut-off matters.
-- Runs with table-owner rights so the status change is not blocked by row security;
-- the role check below is the gate.
create function pay_claim(p_id bigint, p_from text, p_date date) returns bigint
language plpgsql security definer set search_path = public as $$
declare c claims; who text; j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can pay claims'; end if;
  select * into c from claims where id = p_id for update;
  if p_from not in ('1000', '1010', '1100') then raise exception 'Pay from cash, petty cash or bank'; end if;
  if c.status is distinct from 'approved' then raise exception 'Claim must be approved first'; end if;
  select full_name into who from profiles where id = c.staff_id;
  j := post_journal(p_date, 'Claim: ' || who || ' – ' || c.description, 'claim', p_id::text, c.receipt,
    jsonb_build_array(
      jsonb_build_object('account', c.account, 'debit', c.amount),
      jsonb_build_object('account', p_from, 'credit', c.amount)));
  update claims set status = 'paid', paid_journal_id = j where id = p_id;
  return j;
end $$;
