import { createClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

// Read before the client clears the login link from the address bar.
export const arrivedFromEmail = /type=(invite|recovery)/.test(location.hash)

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export type Role = 'owner' | 'manager' | 'accountant' | 'staff'
export type Profile = { id: string; full_name: string; role: Role }
export type Account = { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; active: boolean }
export type Line = { account: string; debit?: number; credit?: number; memo?: string }

// Accounts money can physically come from / go to.
export const MONEY_ACCOUNTS = ['1000', '1010', '1100']

export const rm = (n: number | null | undefined) =>
  'RM ' + (n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
    q.then(({ data }) => setAccounts(data ?? []))
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
  const path = `${todayMY().slice(0, 7)}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(error.message)
  return path
}

export async function openReceipt(path: string) {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
  if (data) window.open(data.signedUrl, '_blank')
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
      const owed = new Map((b.data ?? []).map(r => [r.id, Number(r.owed)]))
      setList((s.data ?? []).map(r => ({ ...r, owed: owed.get(r.id) ?? 0 })))
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
  const { data } = await supabase.rpc('account_totals', { p_from: from, p_to: to })
  return new Map(((data ?? []) as { code: string; debit: number; credit: number }[])
    .map(r => [r.code, Number(r.debit) - Number(r.credit)]))
}
