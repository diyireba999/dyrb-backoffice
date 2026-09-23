-- DYRB Back Office: daily sales from Zeoniq (Phase 3)
-- Run in Supabase SQL Editor after 001-004.
--
-- One journal per business day, taken from the Zeoniq "Bill Summary Listing".
-- The day can only be posted once (journals.source + source_ref).

-- Which account each Zeoniq payment column goes to. Editable on the Sales Settings screen.
create table payment_map (
  code text primary key,                 -- column name in the Zeoniq report, e.g. VISA
  label text not null,
  account text not null references accounts(code)
);

insert into payment_map (code, label, account) values
  ('CASH', 'Cash', '1000'),
  ('VISA', 'Visa card', '1200'),
  ('MASTER', 'Mastercard', '1200'),
  ('AMEX', 'American Express', '1200'),
  ('JCB', 'JCB card', '1200'),
  ('DINERS', 'Diners Club', '1200'),
  ('UNIONPAY', 'UnionPay', '1200'),
  ('MYDEBIT', 'MyDebit', '1200'),
  ('CREDIT', 'Credit card (other)', '1200'),
  ('IPAYMYGW', 'iPay gateway', '1200'),
  ('TNG', 'Touch n Go eWallet', '1210'),
  ('CXMWALLET', 'CXM wallet', '1210'),
  ('CXMPOINT', 'CXM points', '1210'),
  ('IPALIPAYPLUS', 'Alipay+', '1210'),
  ('GF', 'GrabFood / delivery', '1210'),
  ('PREPAID', 'Prepaid / member credit', '1210'),
  ('OTHER', 'Other', '1000'),
  ('STAFF', 'Staff meal (on the house)', '6040'),
  ('ENT', 'Entertainment (on the house)', '6500'),
  ('VOUCHER', 'Voucher redeemed', '6500');

alter table payment_map enable row level security;
create policy "office reads" on payment_map for select using (is_office());
create policy "owner or accountant edits" on payment_map for all
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- Which accounts the sales side goes to.
create table sales_settings (
  id int primary key default 1 check (id = 1),
  sales_account text not null references accounts(code) default '4000',
  service_account text not null references accounts(code) default '4100',
  tax_account text not null references accounts(code) default '2100',
  rounding_account text not null references accounts(code) default '4900',
  discount_account text not null references accounts(code) default '6500'
);
insert into sales_settings (id) values (1);

alter table sales_settings enable row level security;
create policy "office reads" on sales_settings for select using (is_office());
create policy "owner or accountant edits" on sales_settings for update
  using (my_role() in ('owner', 'accountant')) with check (my_role() in ('owner', 'accountant'));

-- Post one business day.
-- p_payments: [{"code":"CASH","amount":380.60}, ...]
-- p_sales_lines (optional, from the category report): [{"account":"4010","amount":250}]
--   when given, it replaces the single sales line and must add up to p_sales.
create function post_sales_day(p_date date, p_sales numeric, p_service numeric, p_tax numeric,
                               p_rounding numeric, p_payments jsonb, p_sales_lines jsonb default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s sales_settings; lines jsonb := '[]'::jsonb; pay numeric := 0; split numeric; p jsonb; acct text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select * into s from sales_settings where id = 1;

  -- Money received (or given away, for staff meals and entertainment).
  for p in select * from jsonb_array_elements(p_payments) loop
    if coalesce((p->>'amount')::numeric, 0) <> 0 then
      select account into acct from payment_map where code = upper(p->>'code');
      if acct is null then
        raise exception 'Payment type % is not set up yet. Add it in Sales Settings.', p->>'code'; end if;
      pay := pay + (p->>'amount')::numeric;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'account', acct, 'memo', p->>'code',
        (case when (p->>'amount')::numeric > 0 then 'debit' else 'credit' end), abs((p->>'amount')::numeric)));
    end if;
  end loop;

  if p_sales_lines is null then
    lines := lines || jsonb_build_array(jsonb_build_object('account', s.sales_account, 'credit', p_sales, 'memo', 'Sales'));
  else
    select coalesce(sum((l->>'amount')::numeric), 0) into split from jsonb_array_elements(p_sales_lines) l;
    if round(split, 2) <> round(p_sales, 2) then
      raise exception 'Category sales (%) do not match the bill summary (%)', split, p_sales; end if;
    lines := lines || (select jsonb_agg(jsonb_build_object('account', l->>'account', 'credit', (l->>'amount')::numeric, 'memo', l->>'memo'))
                       from jsonb_array_elements(p_sales_lines) l where (l->>'amount')::numeric <> 0);
  end if;

  if coalesce(p_service, 0) <> 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', s.service_account, 'credit', p_service, 'memo', 'Service charge'));
  end if;
  if coalesce(p_tax, 0) <> 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', s.tax_account, 'credit', p_tax, 'memo', 'SST'));
  end if;
  if coalesce(p_rounding, 0) <> 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('account', s.rounding_account, 'memo', 'Rounding',
      (case when p_rounding > 0 then 'credit' else 'debit' end), abs(p_rounding)));
  end if;

  if round(pay, 2) <> round(coalesce(p_sales, 0) + coalesce(p_service, 0) + coalesce(p_tax, 0) + coalesce(p_rounding, 0), 2) then
    raise exception 'Payments (%) do not match the day total (%)', round(pay, 2),
      round(coalesce(p_sales, 0) + coalesce(p_service, 0) + coalesce(p_tax, 0) + coalesce(p_rounding, 0), 2);
  end if;

  return post_journal(p_date, 'Daily sales ' || to_char(p_date, 'DD/MM/YYYY'), 'sales', p_date::text, null, lines);
end $$;
