-- DYRB Back Office: second round of review fixes
-- Run in Supabase SQL Editor after 015_fixes.sql. Safe to run again.

-- ---------- 1. EPF is worked out on the wrong pay ----------
-- EPF wages leave out overtime and service charge; SOCSO and EIS include them.
-- Both were being worked out on everything, so contributions were too high.
drop function if exists statutory_for(numeric, boolean, boolean, boolean, boolean);
create function statutory_for(p_epf_wage numeric, p_socso_wage numeric, p_is_local boolean,
                              p_epf boolean, p_socso boolean, p_eis boolean)
returns table (epf_employee numeric, epf_employer numeric, socso_employee numeric,
               socso_employer numeric, eis_employee numeric, eis_employer numeric)
language plpgsql stable set search_path = public, pg_temp as $$
declare r payroll_rates; socso_wage numeric; eis_wage numeric;
begin
  select * into r from payroll_rates where id = 1;
  socso_wage := least(greatest(p_socso_wage, 0), r.socso_wage_ceiling);
  eis_wage := least(greatest(p_socso_wage, 0), r.eis_wage_ceiling);

  -- EPF is rounded up to the next ringgit, as KWSP does.
  if p_epf and p_epf_wage > 0 then
    if p_is_local then
      epf_employee := ceil(p_epf_wage * r.epf_employee_local / 100);
      epf_employer := ceil(p_epf_wage * (case when p_epf_wage <= r.epf_wage_threshold
                                              then r.epf_employer_local_low else r.epf_employer_local_high end) / 100);
    else
      epf_employee := ceil(p_epf_wage * r.epf_employee_foreign / 100);
      epf_employer := ceil(p_epf_wage * r.epf_employer_foreign / 100);
    end if;
  else
    epf_employee := 0; epf_employer := 0;
  end if;

  if p_socso and p_socso_wage > 0 then
    -- Foreign workers: employer pays the work injury part only, nothing from the worker.
    socso_employee := case when p_is_local then round(socso_wage * r.socso_employee / 100, 2) else 0 end;
    socso_employer := round(socso_wage * (case when p_is_local then r.socso_employer else r.socso_employer_foreign end) / 100, 2);
  else
    socso_employee := 0; socso_employer := 0;
  end if;

  -- EIS does not apply to foreign workers.
  if p_eis and p_is_local and p_socso_wage > 0 then
    eis_employee := round(eis_wage * r.eis_employee / 100, 2);
    eis_employer := round(eis_wage * r.eis_employer / 100, 2);
  else
    eis_employee := 0; eis_employer := 0;
  end if;
  return next;
end $$;

create or replace function create_payroll_run(p_month date, p_pay_date date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare run bigint; e employees; s record; first_day date := date_trunc('month', p_month)::date; pay numeric;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can start payroll'; end if;
  if exists (select 1 from payroll_runs where month = first_day) then raise exception 'This month already exists'; end if;
  insert into payroll_runs (month, pay_date) values (first_day, p_pay_date) returning id into run;
  for e in select * from employees where active and (join_date is null or join_date <= (first_day + interval '1 month' - interval '1 day'))
                                     and (leave_date is null or leave_date >= first_day) loop
    pay := case when e.pay_type = 'monthly' then e.rate else 0 end;
    select * into s from statutory_for(pay, pay, e.is_local, e.epf_on, e.socso_on, e.eis_on);
    insert into payslips (run_id, employee_id, basic, hourly_rate,
                          epf_employee, epf_employer, socso_employee, socso_employer, eis_employee, eis_employer)
      values (run, e.id, pay, case when e.pay_type = 'hourly' then e.rate else 0 end,
              s.epf_employee, s.epf_employer, s.socso_employee, s.socso_employer, s.eis_employee, s.eis_employer);
  end loop;
  return run;
end $$;

create or replace function save_payslip(p_id bigint, p_fields jsonb, p_recalc boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p payslips; e employees; epf_wage numeric; socso_wage numeric; s record; st run_status;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can edit payroll'; end if;
  select r.status into st from payslips ps join payroll_runs r on r.id = ps.run_id where ps.id = p_id;
  if st is null then raise exception 'Payslip not found'; end if;
  if st <> 'draft' then raise exception 'This payroll is approved already. Cancel it first to change anything.'; end if;

  update payslips set
    basic = coalesce((p_fields->>'basic')::numeric, basic),
    hours = coalesce((p_fields->>'hours')::numeric, hours),
    hourly_rate = coalesce((p_fields->>'hourly_rate')::numeric, hourly_rate),
    ot_hours = coalesce((p_fields->>'ot_hours')::numeric, ot_hours),
    ot_amount = coalesce((p_fields->>'ot_amount')::numeric, ot_amount),
    allowance = coalesce((p_fields->>'allowance')::numeric, allowance),
    service_charge = coalesce((p_fields->>'service_charge')::numeric, service_charge),
    unpaid_leave = coalesce((p_fields->>'unpaid_leave')::numeric, unpaid_leave),
    other_deduction = coalesce((p_fields->>'other_deduction')::numeric, other_deduction),
    epf_employee = coalesce((p_fields->>'epf_employee')::numeric, epf_employee),
    epf_employer = coalesce((p_fields->>'epf_employer')::numeric, epf_employer),
    socso_employee = coalesce((p_fields->>'socso_employee')::numeric, socso_employee),
    socso_employer = coalesce((p_fields->>'socso_employer')::numeric, socso_employer),
    eis_employee = coalesce((p_fields->>'eis_employee')::numeric, eis_employee),
    eis_employer = coalesce((p_fields->>'eis_employer')::numeric, eis_employer),
    pcb = coalesce((p_fields->>'pcb')::numeric, pcb),
    note = coalesce(p_fields->>'note', note)
  where id = p_id returning * into p;

  if p_recalc then
    select * into e from employees where id = p.employee_id;
    -- Hourly staff: pay is hours x rate.
    if e.pay_type = 'hourly' then
      update payslips set basic = round(p.hours * p.hourly_rate, 2) where id = p_id returning * into p;
    end if;
    epf_wage := p.basic + p.allowance - p.unpaid_leave;                             -- no OT, no service charge
    socso_wage := p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave;
    select * into s from statutory_for(epf_wage, socso_wage, e.is_local, e.epf_on, e.socso_on, e.eis_on);
    update payslips set epf_employee = s.epf_employee, epf_employer = s.epf_employer,
      socso_employee = s.socso_employee, socso_employer = s.socso_employer,
      eis_employee = s.eis_employee, eis_employer = s.eis_employer
    where id = p_id;
  end if;
end $$;

-- ---------- 2. Deleting a sales day left its cost of sales behind ----------
create or replace function delete_journal(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare src text; ref text;
begin
  select source, source_ref into src, ref from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src in ('pi', 'sp') then raise exception 'Cancel this from Purchase Invoice / Supplier Payment instead'; end if;
  if not (my_role() = 'owner' or (is_office() and src in ('manual', 'pv', 'or', 'jv', 'transfer'))) then
    raise exception 'Not allowed to delete this entry'; end if;
  -- A day's cost of sales belongs to that day's sales; it goes with it.
  if src = 'sales' and ref is not null then
    delete from journals where source = 'cogs' and source_ref = ref;
  end if;
  delete from journals where id = p_id;
end $$;

-- ---------- 3. Replacing an entry deleted the old one before knowing there was a new one ----------
create or replace function post_cogs_day(p_date date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare old bigint; lines jsonb := '[]'::jsonb; l jsonb; c category_costing; total numeric := 0;
begin
  if my_role() not in ('owner', 'accountant', 'manager') then raise exception 'Not allowed'; end if;

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
  if total <= 0 then return null; end if;   -- nothing to post: leave what is there alone

  select id into old from journals where source = 'cogs' and source_ref = p_date::text;
  if old is not null then delete from journals where id = old; end if;

  return post_journal(p_date, 'Cost of sales ' || to_char(p_date, 'DD/MM/YYYY'), 'cogs', p_date::text, null, lines);
end $$;

create or replace function post_accruals(p_month date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare first_day date := date_trunc('month', p_month)::date;
        last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        old bigint; lines jsonb := '[]'::jsonb; l jsonb; total numeric := 0;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can post accruals'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'amount')::numeric, 0) > 0 then
      total := total + (l->>'amount')::numeric;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'account', l->>'account', 'debit', (l->>'amount')::numeric, 'memo', l->>'name'));
    end if;
  end loop;
  if total <= 0 then return null; end if;

  select id into old from journals where source = 'accrual' and source_ref = first_day::text;
  if old is not null then delete from journals where id = old; end if;

  lines := lines || jsonb_build_array(jsonb_build_object('account', '2600', 'credit', total, 'memo', 'Accrued'));
  return post_journal(last_day, 'Accruals ' || to_char(first_day, 'Mon YYYY'), 'accrual', first_day::text, null, lines);
end $$;

-- ---------- 4. A re-split could swallow the service charge line ----------
-- Item groups may only point at sales accounts, never at service charge, SST or rounding.
create or replace function resplit_sales_day(p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint; accts text[]; was numeric; now_total numeric; s sales_settings;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can re-split a day'; end if;

  select id into j from journals where source = 'sales' and source_ref = p_date::text;
  if j is null then raise exception 'There is no daily sales entry for %', p_date; end if;
  select * into s from sales_settings where id = 1;

  select array_agg(distinct code) into accts from (
    select s.sales_account as code
    union select m.account from item_category_map m
    join accounts a on a.code = m.account and a.type = 'income'
    where m.account not in (s.service_account, s.tax_account, s.rounding_account)) a;

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

-- ---------- 5. A purchase could be booked to cost while cost of sales was also running ----------
create or replace function create_purchase_invoice(p_supplier bigint, p_invoice_no text, p_date date, p_due date,
                                        p_description text, p_lines jsonb, p_attachment text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare total numeric; j bigint; inv bigint; bad text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  if p_due < p_date then raise exception 'Due date cannot be before invoice date'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'amount')::numeric, 0) <= 0) then
    raise exception 'Each line needs an amount'; end if;
  -- Stock is costed when it sells, so a purchase goes to the stock account, not the cost account.
  select string_agg(distinct l->>'account', ', ') into bad from jsonb_array_elements(p_lines) l
    where l->>'account' in (select cost_account from category_costing);
  if bad is not null then
    raise exception 'Use the stock account instead of % — the cost is booked when the item sells', bad; end if;
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

-- ---------- 6. Card fee report grouped on the wrong text when no card types were given ----------
create or replace function post_fiuu_settlement(p_settle_date date, p_gross numeric, p_fee numeric,
                                     p_net numeric, p_bank text default '1100', p_note text default null,
                                     p_brands jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare lines jsonb; b jsonb; sum_gross numeric := 0; sum_fee numeric := 0;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  if p_bank not in ('1100', '1000', '1010') then raise exception 'Money must go into a bank or cash account'; end if;
  if round(p_gross, 2) <> round(p_net + p_fee, 2) then
    raise exception 'Gross (%) is not net (%) plus fee (%)', p_gross, p_net, p_fee; end if;
  if p_gross <= 0 then raise exception 'Nothing to settle'; end if;

  lines := jsonb_build_array(jsonb_build_object('account', p_bank, 'debit', p_net, 'memo', 'Fiuu payout'));

  if p_brands is null then
    lines := lines || jsonb_build_array(
      jsonb_build_object('account', '6200', 'debit', p_fee, 'memo', 'Fiuu fee'),
      jsonb_build_object('account', '1200', 'credit', p_gross, 'memo', 'Fiuu'));
  else
    for b in select * from jsonb_array_elements(p_brands) loop
      sum_gross := sum_gross + (b->>'gross')::numeric;
      sum_fee := sum_fee + (b->>'fee')::numeric;
      if (b->>'fee')::numeric > 0 then
        lines := lines || jsonb_build_array(jsonb_build_object(
          'account', '6200', 'debit', (b->>'fee')::numeric, 'memo', (b->>'brand') || ' fee'));
      end if;
      lines := lines || jsonb_build_array(jsonb_build_object(
        'account', '1200', 'credit', (b->>'gross')::numeric, 'memo', b->>'brand'));
    end loop;
    if round(sum_gross, 2) <> round(p_gross, 2) or round(sum_fee, 2) <> round(p_fee, 2) then
      raise exception 'Card type totals (% takings, % fee) do not match the payout (% and %)',
        round(sum_gross, 2), round(sum_fee, 2), round(p_gross, 2), round(p_fee, 2); end if;
  end if;

  return post_journal(p_settle_date, coalesce(p_note, 'Fiuu card settlement'), 'fiuu', p_settle_date::text, null, lines);
end $$;

-- ---------- 7. Cancelling a payment that does not exist looked like it worked ----------
create or replace function cancel_supplier_payment(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can cancel'; end if;
  delete from supplier_payments where id = p_id returning journal_id into j;
  if j is null then raise exception 'Payment not found'; end if;
  delete from journals where id = j;
end $$;

-- ---------- 8. Receipt photos land in a folder per person ----------
-- The app now uploads to <user id>/<month>/<file>. Uploads are limited to your
-- own folder; office staff can still read every receipt.
drop policy if exists "logged-in uploads receipts" on storage.objects;
create policy "uploads to own folder" on storage.objects for insert
  with check (bucket_id = 'receipts' and auth.uid() is not null
              and (storage.foldername(name))[1] = auth.uid()::text);
