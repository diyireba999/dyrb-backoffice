-- DYRB Back Office: correcting a document (018)
-- Run in Supabase SQL Editor after 017_corkage.sql.
--
-- Until now a wrong entry could only be deleted and retyped. These functions let a
-- document be opened and changed while keeping its number, so PV-000012 stays
-- PV-000012. Nothing here deletes or rewrites data that is already in the books.
--
-- Only documents typed in by hand may be edited this way: manual, pv, or, jv,
-- transfer. A document produced by another screen (daily sales, payroll, a claim,
-- a card settlement, a stock count) is changed on that screen and re-posted, so
-- the record and the ledger never drift apart.

alter table journals add column if not exists updated_at timestamptz;
alter table journals add column if not exists updated_by uuid references auth.users;

create or replace function update_journal(p_id bigint, p_date date, p_description text,
                                          p_reference text, p_attachment text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare src text;
begin
  if not is_office() then raise exception 'Not allowed'; end if;
  select source into src from journals where id = p_id;
  if src is null then raise exception 'Entry not found'; end if;
  if src not in ('manual', 'pv', 'or', 'jv', 'transfer') then
    raise exception 'This document is changed on the screen that created it, not here'; end if;
  if exists (select 1 from journal_lines where journal_id = p_id and cleared_on is not null) then
    raise exception 'This entry is ticked on the bank reconciliation. Untick it there first.'; end if;
  if jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             join accounts a on a.code = l->>'account' where not a.active) then
    raise exception 'Account is switched off'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where l->>'account' = '2000') then
    raise exception 'Supplier entries are changed from Purchase Invoice or Supplier Payment'; end if;

  delete from journal_lines where journal_id = p_id;
  insert into journal_lines (journal_id, account, debit, credit, memo)
    select p_id, l->>'account', coalesce((l->>'debit')::numeric, 0),
           coalesce((l->>'credit')::numeric, 0), l->>'memo'
    from jsonb_array_elements(p_lines) l;
  update journals
     set date = p_date, description = p_description,
         reference = nullif(p_reference, ''),
         attachment = coalesce(p_attachment, attachment),
         updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;
