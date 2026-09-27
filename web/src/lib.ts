import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import type { DayAmount } from './dashboard-math'
import { supplierInvoiceCategory } from './dashboard-math'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// Every list in the app goes through this, so a failed request is never mistaken
// for an empty table.
export function rowsOf<T>(r: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (r.error) console.error(`Could not load ${what}:`, r.error.message)
  return r.data ?? []
}

export type Role = 'owner' | 'manager' | 'accountant' | 'staff'
export type Profile = { id: string; full_name: string; username: string; role: Role }

// Supabase signs in by email; a username is kept as <username>@dyrb.local (022_usernames.sql).
export const loginEmail = (username: string) => `${username.trim().toLowerCase()}@dyrb.local`
export type Account = { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; active: boolean }
export type Line = { account: string; debit?: number; credit?: number; memo?: string }

// Accounts money can physically come from / go to.
export const MONEY_ACCOUNTS = ['1000', '1010', '1100']

// Director accounts: 2500, 2510... one per director. Paying from these means the
// director used their own money and the business owes them.
export const isDirector = (code: string) => code >= '2500' && code < '2600'

export const rm = (n: number | null | undefined) =>
  'RM ' + (Math.round((n ?? 0) * 100) / 100 || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const round2 = (n: number) => Math.round(n * 100) / 100

// Today in Malaysia time as YYYY-MM-DD (for <input type="date">).
export const todayMY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })

// YYYY-MM-DD -> DD/MM/YYYY
export const dmy = (iso: string) => iso.split('-').reverse().join('/')

// Reports pass includeInactive so switched-off accounts with old balances still add up.
export function useAccounts(includeInactive = false) {
  const [accounts, setAccounts] = useState<Account[]>([])
  useEffect(() => {
    let q = supabase.from('accounts').select('*').order('code')
    if (!includeInactive) q = q.eq('active', true)
    q.then(r => setAccounts(rowsOf(r, 'the account list')))
  }, [includeInactive])
  return accounts
}

export async function postJournal(date: string, description: string, lines: Line[],
                                  opts: { source?: string; ref?: string; attachment?: string; supplier?: number; reference?: string } = {}) {
  const { data, error } = await supabase.rpc('post_journal', {
    p_date: date, p_description: description, p_source: opts.source ?? 'manual',
    p_ref: opts.ref ?? null, p_attachment: opts.attachment ?? null, p_lines: lines, p_supplier: opts.supplier ?? null, p_reference: opts.reference ?? null,
  })
  if (error) throw new Error(error.message)
  return data as number
}

// Shrink phone photos to ~1600px JPEG before upload to keep within free 1 GB storage.
export async function uploadReceipt(file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = img.width * scale
  canvas.height = img.height * scale
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7))
  const { data: me } = await supabase.auth.getUser()
  const path = `${me.user?.id ?? 'shared'}/${todayMY().slice(0, 7)}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(error.message)
  return path
}

export async function openReceipt(path: string) {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
  if (error || !data) return alert('Could not open the receipt: ' + (error?.message ?? 'not found'))
  window.open(data.signedUrl, '_blank')
}

export const MONEY_NAMES: Record<string, string> = { '1000': 'Cash in Drawer', '1010': 'Petty Cash', '1100': 'Bank' }

export type Supplier = { id: number; name: string; phone: string | null; default_account: string | null; owed: number }

export function useSuppliers() {
  const [list, setList] = useState<Supplier[]>([])
  const load = () => {
    Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_balances').select('id, owed'),
    ]).then(([s, b]) => {
      const owed = new Map(rowsOf(b, 'supplier balances').map(r => [r.id, Number(r.owed)]))
      setList(rowsOf(s, 'suppliers').map(r => ({ ...r, owed: owed.get(r.id) ?? 0 })))
    })
  }
  useEffect(load, [])
  return { list, load }
}

// Opens in Excel. Quotes every cell so commas in descriptions are safe.
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export const monthStart = () => todayMY().slice(0, 8) + '01'

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

// Net debit (debit minus credit) per account code, summed in the database.
export async function accountTotals(from: string | null, to: string) {
  const { data, error } = await supabase.rpc('account_totals', { p_from: from, p_to: to })
  if (error) console.error('Could not total the accounts:', error.message)
  return new Map(((data ?? []) as { code: string; debit: number; credit: number }[])
    .map(r => [r.code, Number(r.debit) - Number(r.credit)]))
}

// Documents typed in by hand. Anything else is changed on the screen that made it.
export const EDITABLE_SOURCES = ['manual', 'pv', 'or', 'jv', 'transfer']

export async function updateJournal(id: number, date: string, description: string, lines: Line[],
                                    opts: { reference?: string; attachment?: string } = {}) {
  const { error } = await supabase.rpc('update_journal', {
    p_id: id, p_date: date, p_description: description,
    p_reference: opts.reference ?? null, p_attachment: opts.attachment ?? null, p_lines: lines,
  })
  if (error) throw new Error(error.message)
}

export type DocRow = {
  id: number; doc_no: string; date: string; description: string
  reference: string | null; source: string; attachment: string | null
  updated_at: string | null
  journal_lines: { account: string; debit: number; credit: number; memo: string | null; cleared_on: string | null }[]
}

// One document type, newest first. Default window is the last three whole months.
export async function loadDocuments(source: string, months = 3): Promise<DocRow[]> {
  const [y, m] = monthStart().split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1 - (months - 1), 1)).toISOString().slice(0, 10)
  const { data, error } = await supabase.from('journals')
    .select('id, doc_no, date, description, reference, source, attachment, updated_at, journal_lines(account, debit, credit, memo, cleared_on)')
    .eq('source', source).gte('date', from)
    .order('date', { ascending: false }).order('id', { ascending: false })
  if (error) throw new Error('Could not load the document list: ' + error.message)
  return (data as unknown as DocRow[]) ?? []
}

// Total of a document, for the list column. Debits and credits are equal.
export const docTotal = (d: DocRow) => d.journal_lines.reduce((s, l) => s + Number(l.debit), 0)

export const isReconciled = (d: DocRow) => d.journal_lines.some(l => l.cleared_on !== null)

// Income accounts are credit-balance, so credit minus debit reads positive.
// For a daily series over a narrow account range (e.g. 4 sales accounts, 42 days ≈ 168 rows).
// For wider ranges or period aggregates, use accountTotals(from, to) instead.
export async function dailyNet(from: string, to: string, codeFrom: string, codeTo: string): Promise<DayAmount[]> {
  const { data, error } = await supabase.from('account_balances')
    .select('date, debit, credit')
    .gte('date', from).lte('date', to)
    .gte('code', codeFrom).lt('code', codeTo)
    .limit(5000)
  if (error) throw new Error('Could not load the daily figures: ' + error.message)
  if (data?.length === 5000) throw new Error('Daily series truncated (≥5000 rows); use accountTotals for wider ranges')
  const byDay = new Map<string, number>()
  for (const r of (data ?? []) as { date: string; debit: number | string; credit: number | string }[]) {
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + (Number(r.credit) - Number(r.debit)))
  }
  return [...byDay].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date))
}

// What is owed to suppliers, split by whether it is already late.
export async function supplierDue(today: string) {
  const { data, error } = await supabase.from('purchase_invoice_status')
    .select('due_date, outstanding').gt('outstanding', 0)
  if (error) throw new Error('Could not load supplier due dates: ' + error.message)
  const soon = addDays(today, 7)
  let dueSoon = 0, overdue = 0
  for (const r of (data ?? []) as { due_date: string; outstanding: number | string }[]) {
    const amt = Number(r.outstanding)
    const cat = supplierInvoiceCategory(r.due_date, today, soon)
    if (cat === 'overdue') overdue += amt
    else if (cat === 'dueSoon') dueSoon += amt
  }
  return { dueSoon: round2(dueSoon), overdue: round2(overdue) }
}
