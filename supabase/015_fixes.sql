-- DYRB Back Office: fixes found in the review before going live
-- Run in Supabase SQL Editor after 014_recurring.sql. Safe to run again.

-- Staff could not open their own payslip: the payslip view reads payroll_runs,
-- and only office roles could see that table.
drop policy if exists "office reads" on payroll_runs;
create policy "office reads, staff read runs with their payslip" on payroll_runs for select
  using (is_office() or exists (
    select 1 from payslips p join employees e on e.id = p.employee_id
    where p.run_id = payroll_runs.id and e.profile_id = auth.uid()));
