import { useEffect, useState } from 'react'
import { MONEY_ACCOUNTS, dmy, openReceipt, rm, round2, supabase, todayMY, uploadReceipt, useAccounts, type Profile } from '../lib'

type Status = 'pending' | 'approved' | 'rejected' | 'paid'
type Claim = {
  id: number; staff_id: string; date: string; account: string; description: string; amount: number
  receipt: string | null; status: Status; review_note: string | null
  staff: { full_name: string }; accounts: { name: string }
}

const STATUS_STYLE: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-800', approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800', paid: 'bg-green-100 text-green-800',
}
const SELECT = '*, staff:profiles!claims_staff_id_fkey(full_name), accounts(name)'

function NewClaim({ onSaved }: { onSaved: () => void }) {
  const accounts = useAccounts()
  const [f, setF] = useState({ date: todayMY(), account: '', description: '', amount: '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    if (!photo) return setError('Please add a receipt photo')
    setBusy(true); setError('')
    try {
      const receipt = await uploadReceipt(photo)
      const { error } = await supabase.from('claims').insert({ ...f, amount, receipt })
      if (error) throw new Error(error.message)
      setF({ ...f, account: '', description: '', amount: '' }); setPhoto(null)
      ;(e.target as HTMLFormElement).reset()
      onSaved()
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <h3 className="text-lg font-semibold">New claim</h3>
      <div className="grid md:grid-cols-2 gap-3">
        <div><label>Date spent</label><input type="date" value={f.date} max={todayMY()} onChange={e => set('date', e.target.value)} required /></div>
        <div>
          <label>Type</label>
          <select value={f.account} onChange={e => set('account', e.target.value)} required>
            <option value="">— choose —</option>
            {accounts.filter(a => a.type === 'expense' && a.code >= '5000').map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>
        </div>
        <div><label>What did you buy?</label><input value={f.description} onChange={e => set('description', e.target.value)} placeholder="e.g. ice from 7-Eleven" required /></div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      </div>
      <div><label>Receipt photo</label><input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files?.[0] ?? null)} /></div>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <button className="btn w-full md:w-auto" disabled={busy}>{busy ? 'Sending…' : 'Submit claim'}</button>
    </form>
  )
}

function ClaimCard({ c, actions }: { c: Claim; actions?: React.ReactNode }) {
  return (
    <div className="card space-y-1">
      <div className="flex flex-wrap gap-2 items-baseline">
        <span className="font-semibold">{rm(c.amount)}</span>
        <span>{c.description}</span>
        <span className={`text-xs rounded px-1.5 py-0.5 ${STATUS_STYLE[c.status]}`}>{c.status}</span>
      </div>
      <div className="text-sm text-stone-500 flex flex-wrap gap-3">
        <span>{dmy(c.date)}</span><span>{c.staff.full_name}</span><span>{c.accounts.name}</span>
        {c.receipt && <button className="text-brand underline" onClick={() => openReceipt(c.receipt!)}>Receipt</button>}
      </div>
      {c.review_note && <p className="text-sm">Note: {c.review_note}</p>}
      {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
    </div>
  )
}

export function Claims({ profile }: { profile: Profile }) {
  const [claims, setClaims] = useState<Claim[]>([])
  const [tab, setTab] = useState<Status | 'mine'>(profile.role === 'staff' ? 'mine' : 'pending')
  const [payFrom, setPayFrom] = useState('1010')
  const office = profile.role !== 'staff'
  const canReview = (c: Claim) => profile.role === 'owner' || (profile.role === 'manager' && c.staff_id !== profile.id)
  const canPay = profile.role === 'owner' || profile.role === 'accountant'

  const load = () => {
    supabase.from('claims').select(SELECT).order('date', { ascending: false }).limit(300)
      .then(({ data }) => setClaims((data as unknown as Claim[]) ?? []))
  }
  useEffect(load, [])

  async function review(c: Claim, status: 'approved' | 'rejected') {
    const note = status === 'rejected' ? prompt('Reason for rejecting?') : ''
    if (note === null) return
    const { error } = await supabase.from('claims')
      .update({ status, review_note: note || null, reviewed_by: profile.id }).eq('id', c.id)
    if (error) alert(error.message)
    load()
  }

  async function pay(c: Claim) {
    const { error } = await supabase.rpc('pay_claim', { p_id: c.id, p_from: payFrom, p_date: todayMY() })
    if (error) alert(error.message)
    load()
  }

  async function remove(c: Claim) {
    if (!confirm('Cancel this claim?')) return
    await supabase.from('claims').delete().eq('id', c.id)
    load()
  }

  const shown = tab === 'mine' ? claims.filter(c => c.staff_id === profile.id) : claims.filter(c => c.status === tab)
  const tabs: (Status | 'mine')[] = office ? ['pending', 'approved', 'paid', 'rejected', 'mine'] : []
  const approvedTotal = claims.filter(c => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Claims</h2>
      <NewClaim onSaved={() => { setTab('mine'); load() }} />

      {office && (
        <div className="flex flex-wrap gap-2">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={tab === t ? 'btn' : 'btn-light'}>
              {t === 'mine' ? 'My claims' : t[0].toUpperCase() + t.slice(1)}
              {t !== 'mine' && ` (${claims.filter(c => c.status === t).length})`}
            </button>
          ))}
        </div>
      )}
      {!office && <h3 className="text-lg font-semibold">My claims</h3>}

      {tab === 'approved' && canPay && shown.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3">
          <div className="grow"><span className="font-semibold">{rm(approvedTotal)}</span> waiting to be paid</div>
          <div className="w-56">
            <label>Pay from</label>
            <select value={payFrom} onChange={e => setPayFrom(e.target.value)}>
              {MONEY_ACCOUNTS.map(code => <option key={code} value={code}>{{ '1000': 'Cash in Drawer', '1010': 'Petty Cash', '1100': 'Bank' }[code]}</option>)}
            </select>
          </div>
        </div>
      )}

      {shown.length === 0 && <p className="text-stone-500">Nothing here.</p>}
      {shown.map(c => (
        <ClaimCard key={c.id} c={c} actions={<>
          {c.status === 'pending' && canReview(c) && <>
            <button className="btn" onClick={() => review(c, 'approved')}>Approve</button>
            <button className="btn-light" onClick={() => review(c, 'rejected')}>Reject</button>
          </>}
          {c.status === 'approved' && canPay && <button className="btn" onClick={() => pay(c)}>Mark paid</button>}
          {c.status === 'pending' && c.staff_id === profile.id && <button className="btn-light" onClick={() => remove(c)}>Cancel</button>}
        </>} />
      ))}
    </div>
  )
}
