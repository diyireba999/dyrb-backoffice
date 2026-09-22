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

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  useEffect(() => {
    supabase.from('accounts').select('*').eq('active', true).order('code')
      .then(({ data }) => setAccounts(data ?? []))
  }, [])
  return accounts
}

export async function postJournal(date: string, description: string, lines: Line[],
                                  opts: { source?: string; ref?: string; attachment?: string; supplier?: number } = {}) {
  const { data, error } = await supabase.rpc('post_journal', {
    p_date: date, p_description: description, p_source: opts.source ?? 'manual',
    p_ref: opts.ref ?? null, p_attachment: opts.attachment ?? null, p_lines: lines, p_supplier: opts.supplier ?? null,
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
