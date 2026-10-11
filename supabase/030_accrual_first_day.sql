-- DYRB Back Office: monthly accruals dated the 1st of the month (030)
-- Run in Supabase SQL Editor after 029_payroll_payment.sql. Safe to run again.
--
-- Rent and the other monthly costs are charged from the first day of the
-- month they cover, so they show in that month's figures from day one
-- instead of appearing only on the last day.

-- Copied from 016_fixes2.sql (the current version); only the posting date changed.
create or replace function post_accruals(p_month date, p_lines jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare first_day date := date_trunc('month', p_month)::date;
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
  return post_journal(first_day, 'Accruals ' || to_char(first_day, 'Mon YYYY'), 'accrual', first_day::text, null, lines);
end $$;

-- Move accruals already posted on the last day back to the 1st of their month.
update journals set date = source_ref::date
  where source = 'accrual' and date <> source_ref::date;
