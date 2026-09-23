-- DYRB Back Office: Fiuu settlement split by card type
-- Run in Supabase SQL Editor after 007_fiuu.sql.
--
-- Visa, Mastercard and MyDebit carry different rates, so the payout is booked
-- with one line per card type on both sides: the takings cleared out of 1200 and
-- the fee charged on them. The memo carries the card type, so the General Ledger
-- shows what each one cost.

drop function if exists post_fiuu_settlement(date, numeric, numeric, numeric, text, text);

-- p_brands (optional): [{"brand":"VISA","gross":1696.20,"fee":25.44}, ...]
create function post_fiuu_settlement(p_settle_date date, p_gross numeric, p_fee numeric,
                                     p_net numeric, p_bank text default '1100', p_note text default null,
                                     p_brands jsonb default null)
returns bigint language plpgsql security definer set search_path = public as $$
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
      jsonb_build_object('account', '1200', 'credit', p_gross, 'memo', 'Card takings settled'));
  else
    for b in select * from jsonb_array_elements(p_brands) loop
      sum_gross := sum_gross + (b->>'gross')::numeric;
      sum_fee := sum_fee + (b->>'fee')::numeric;
      if (b->>'fee')::numeric > 0 then
        lines := lines || jsonb_build_array(jsonb_build_object(
          'account', '6200', 'debit', (b->>'fee')::numeric,
          'memo', (b->>'brand') || ' fee'));
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

-- What each card type costs: takings, fee and the rate that works out to.
create or replace view card_fees_by_type with (security_invoker = true) as
  select j.date,
         replace(l.memo, ' fee', '') as card_type,
         sum(case when l.account = '1200' then l.credit else 0 end) as takings,
         sum(case when l.account = '6200' then l.debit else 0 end) as fee
  from journal_lines l
  join journals j on j.id = l.journal_id
  where j.source = 'fiuu' and l.account in ('1200', '6200') and l.memo is not null
  group by j.date, replace(l.memo, ' fee', '');
