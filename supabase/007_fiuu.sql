-- DYRB Back Office: Fiuu card settlements (Phase 3b)
-- Run in Supabase SQL Editor after 005_sales.sql.
--
-- Cards taken on the POS sit in 1200 "Fiuu Card (to be settled)". Fiuu pays the
-- money into the bank a day or two later, less its fee. One entry per payout day:
--   Dr Bank            net received
--   Dr Card fees       Fiuu's fee
--     Cr Fiuu Card     what the customers paid

create function post_fiuu_settlement(p_settle_date date, p_gross numeric, p_fee numeric,
                                     p_net numeric, p_bank text default '1100', p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  if p_bank not in ('1100', '1000', '1010') then raise exception 'Money must go into a bank or cash account'; end if;
  if round(p_gross, 2) <> round(p_net + p_fee, 2) then
    raise exception 'Gross (%) is not net (%) plus fee (%)', p_gross, p_net, p_fee; end if;
  if p_gross <= 0 then raise exception 'Nothing to settle'; end if;

  return post_journal(p_settle_date, coalesce(p_note, 'Fiuu card settlement'), 'fiuu', p_settle_date::text, null,
    jsonb_build_array(
      jsonb_build_object('account', p_bank, 'debit', p_net, 'memo', 'Fiuu payout'),
      jsonb_build_object('account', '6200', 'debit', p_fee, 'memo', 'Fiuu fee'),
      jsonb_build_object('account', '1200', 'credit', p_gross, 'memo', 'Card takings settled')));
end $$;
