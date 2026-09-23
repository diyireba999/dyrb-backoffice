-- DYRB Back Office: monthly accruals
-- Run in Supabase SQL Editor after 013_accruals.sql.
--
-- The handful of costs that come every month (rent, electricity, water,
-- internet, licences). Tick the month and the journal is posted for you:
--   Dr the expense account        Cr 2600 Accrued Expenses
-- Paying the bill later clears 2600 with a Payment Voucher.

create table recurring_accruals (
  id bigint generated always as identity primary key,
  name text not null,
  account text not null references accounts(code),
  amount numeric(12,2) not null default 0,
  active boolean not null default true,
  sort int not null default 0
);

insert into recurring_accruals (name, account, amount, sort) values
  ('Rent', '6100', 0, 1),
  ('Electricity (TNB)', '6110', 0, 2),
  ('Water', '6110', 0, 3),
  ('Internet & phone', '6120', 0, 4);

alter table recurring_accruals enable row level security;
create policy "office reads" on recurring_accruals for select using (is_office());
create policy "owner or accountant edits" on recurring_accruals for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- p_lines: [{"account":"6100","amount":8000,"name":"Rent"}, ...]
-- Posting the same month again replaces the earlier accrual.
create function post_accruals(p_month date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare first_day date := date_trunc('month', p_month)::date;
        last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        old bigint; lines jsonb := '[]'::jsonb; l jsonb; total numeric := 0;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can post accruals'; end if;

  select id into old from journals where source = 'accrual' and source_ref = first_day::text;
  if old is not null then delete from journals where id = old; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'amount')::numeric, 0) > 0 then
      total := total + (l->>'amount')::numeric;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'account', l->>'account', 'debit', (l->>'amount')::numeric, 'memo', l->>'name'));
    end if;
  end loop;
  if total <= 0 then return null; end if;

  lines := lines || jsonb_build_array(jsonb_build_object('account', '2600', 'credit', total, 'memo', 'Accrued'));
  return post_journal(last_day, 'Accruals ' || to_char(first_day, 'Mon YYYY'), 'accrual', first_day::text, null, lines);
end $$;
