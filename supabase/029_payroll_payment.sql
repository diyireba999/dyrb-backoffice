-- DYRB Back Office: paying the payroll from an account (029)
-- Run in Supabase SQL Editor after 028_payroll_paid.sql. Safe to run again.
--
-- Approving a run accrues the net pay in 2300 Salaries Payable. Marking it
-- paid now posts the payment too: Dr 2300 / Cr the account it was paid from
-- (cash, petty cash, bank, or a director who paid out of pocket). With no
-- account, only the date is recorded, for months already paid by a Payment
-- Voucher. Undoing the paid mark removes that payment entry.

alter table payroll_runs add column if not exists paid_journal_id bigint references journals on delete set null;

drop function if exists mark_payroll_paid(bigint, date);
create or replace function mark_payroll_paid(p_id bigint, p_date date, p_from text default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r payroll_runs; net numeric; j bigint;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can mark payroll as paid'; end if;
  select * into r from payroll_runs where id = p_id for update;
  if r.status is distinct from 'approved' then raise exception 'Approve this payroll first.'; end if;

  if p_date is null then
    if r.paid_journal_id is not null then
      if exists (select 1 from journal_lines where journal_id = r.paid_journal_id and cleared_on is not null) then
        raise exception 'This payment is ticked on the bank reconciliation. Untick it there first.'; end if;
      delete from journals where id = r.paid_journal_id;
    end if;
    update payroll_runs set paid_on = null, paid_journal_id = null where id = p_id;
    return null;
  end if;

  if r.paid_on is not null then raise exception 'This payroll is already marked as paid.'; end if;
  if p_from is not null then
    if p_from not in ('1000', '1010', '1100') and not (p_from >= '2500' and p_from < '2600') then
      raise exception 'Pay from cash, petty cash, bank or a director'; end if;
    select coalesce(sum(net_pay), 0) into net from payslip_view where run_id = p_id;
    if net > 0 then
      -- source_ref 'paid-<run>': the approval entry already holds ('payroll', <run>).
      j := post_journal(p_date, 'Salaries paid ' || to_char(r.month, 'Mon YYYY'), 'payroll', 'paid-' || p_id, null,
        jsonb_build_array(jsonb_build_object('account', '2300', 'debit', net, 'memo', 'Net pay to staff'),
                          jsonb_build_object('account', p_from, 'credit', net)));
    end if;
  end if;
  update payroll_runs set paid_on = p_date, paid_journal_id = j where id = p_id;
  return j;
end $$;
