-- DYRB Back Office: approved payroll is not paid payroll (028)
-- Run in Supabase SQL Editor after 027_payroll_hours.sql. Safe to run again.
--
-- Approving a run posts the salary to 2300 Salaries Payable; the staff are
-- still owed. paid_on records the day the money actually went out, set by the
-- owner or accountant after paying (Payment Voucher from 2300). Payslips say
-- "Paid on" only once it is set.

alter table payroll_runs add column if not exists paid_on date;

-- Copied from 019_advance.sql (the current version); only r.paid_on added.
drop view if exists payslip_view;
create view payslip_view with (security_invoker = true) as
  select p.*, e.name, e.employee_no, e.id_no, e.is_local, e.position, e.bank_name, e.bank_account,
         e.epf_no, e.socso_no, e.tax_no, e.profile_id, r.month, r.pay_date, r.status, r.paid_on,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave) as gross,
         (p.basic + p.ot_amount + p.allowance + p.service_charge - p.unpaid_leave
          - p.epf_employee - p.socso_employee - p.eis_employee - p.pcb - p.other_deduction
          - p.advance_recovery) as net_pay,
         (p.epf_employer + p.socso_employer + p.eis_employer) as employer_cost
  from payslips p
  join employees e on e.id = p.employee_id
  join payroll_runs r on r.id = p.run_id;

-- p_date null takes the paid mark off again.
create or replace function mark_payroll_paid(p_id bigint, p_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare st run_status;
begin
  if my_role() not in ('owner', 'accountant') then raise exception 'Only owner or accountant can mark payroll as paid'; end if;
  select status into st from payroll_runs where id = p_id;
  if st is distinct from 'approved' then raise exception 'Approve this payroll first.'; end if;
  update payroll_runs set paid_on = p_date where id = p_id;
end $$;

-- Copied from 019_advance.sql (the current version); now refuses a paid run.
create or replace function cancel_payroll_run(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j bigint;
begin
  if my_role() <> 'owner' then raise exception 'Only the owner can cancel payroll'; end if;
  if (select paid_on from payroll_runs where id = p_id) is not null then
    raise exception 'This payroll is marked as paid. Undo the paid mark first.';
  end if;
  select journal_id into j from payroll_runs where id = p_id;
  delete from advance_recoveries where run_id = p_id;
  update payroll_runs set status = 'draft', journal_id = null, approved_by = null, approved_at = null where id = p_id;
  if j is not null then delete from journals where id = j; end if;
end $$;
