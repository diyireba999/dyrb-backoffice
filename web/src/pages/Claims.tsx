import { useEffect, useState } from 'react'
import { MONEY_ACCOUNTS, MONEY_NAMES, dmy, isCostAccount, isDirector, isOffice, openReceipt, rm, round2, supabase, todayMY, useAccounts, type Profile } from '../lib'
import { Empty, Pill } from '../ui'
import { confirmDialog, toast } from '../feedback'

type Status = 'pending' | 'approved' | 'rejected' | 'paid'
type Claim = {
  id: number; staff_id: string; date: string; account: string; description: string; amount: number
  receipt: string | null; status: Status; review_note: string | null
  staff: { full_name: string }; accounts: { name: string }
}

const SELECT = '*, staff:profiles!claims_staff_id_fkey(full_name), accounts(name)'

function NewClaim({ onSaved }: { onSaved: () => void }) {
  const accounts = useAccounts()
  const [f, setF] = useState({ date: todayMY(), account: '', description: '', amount: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = round2(Number(f.amount))
    if (!(amount > 0)) return setError('Enter an amount')
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('claims').insert({ ...f, amount })
      if (error) throw new Error(error.message)
      setF({ ...f, account: '', description: '', amount: '' })
      onSaved()
      toast(`Claim saved · ${rm(amount)}`)
    } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <h3 className="font-semibold">New claim</h3>
      <div className="grid md:grid-cols-2 gap-3">
        <div><label>Date spent</label><input type="date" value={f.date} max={todayMY()} onChange={e => set('date', e.target.value)} required /></div>
        <div>
          <label>Type</label>
          <select value={f.account} onChange={e => set('account', e.target.value)} required>
            <option value="">— choose —</option>
            {accounts.filter(a => a.type === 'expense' && a.code >= '5000' && !isCostAccount(a.code)).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>
        </div>
        <div><label>What did you buy?</label><input value={f.description} onChange={e => set('description', e.target.value)} placeholder="e.g. ice from 7-Eleven" required /></div>
        <div><label>Amount (RM)</label><input type="number" step="0.01" min="0" inputMode="decimal" value={f.amount} onChange={e => set('amount', e.target.value)} required /></div>
      </div>
      {error && <p className="alert-error">{error}</p>}
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
        <Pill tone={c.status === 'paid' ? 'ok' : c.status === 'rejected' ? 'danger' : c.status === 'approved' ? 'none' : 'warn'}>{c.status}</Pill>
      </div>
      <div className="text-sm text-slate-500 flex flex-wrap gap-3">
        <span>{dmy(c.date)}</span><span>{c.staff.full_name}</span><span>{c.accounts.name}</span>
        {c.receipt && <button className="link" onClick={() => openReceipt(c.receipt!)}>Receipt</button>}
      </div>
      {c.review_note && <p className="text-sm">Note: {c.review_note}</p>}
      <div className="flex flex-wrap gap-2 pt-2 empty:hidden">{actions}</div>
    </div>
  )
}

export function Claims({ profile }: { profile: Profile }) {
  const accounts = useAccounts()
  const [claims, setClaims] = useState<Claim[]>([])
  const [tab, setTab] = useState<Status | 'mine'>(profile.role === 'staff' ? 'mine' : 'pending')
  const [payFrom, setPayFrom] = useState('1010')
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const office = isOffice(profile.role)
  const canReview = (c: Claim) => profile.role === 'owner' || (profile.role === 'manager' && c.staff_id !== profile.id)
  const canPay = profile.role === 'owner' || profile.role === 'accountant'

  const load = () => {
    supabase.from('claims').select(SELECT).order('date', { ascending: false }).limit(300)
      .then(({ data }) => setClaims((data as unknown as Claim[]) ?? []))
  }
  useEffect(load, [])

  async function review(c: Claim, status: 'approved' | 'rejected', note = '') {
    const { error } = await supabase.from('claims')
      .update({ status, review_note: note || null, reviewed_by: profile.id }).eq('id', c.id)
    if (error) toast(error.message, { kind: 'error' })
    setRejecting(null); setReason('')
    load()
  }

  async function pay(c: Claim) {
    const { error } = await supabase.rpc('pay_claim', { p_id: c.id, p_from: payFrom, p_date: todayMY() })
    if (error) toast(error.message, { kind: 'error' })
    load()
  }

  async function unpay(c: Claim) {
    if (!await confirmDialog({ title: `Undo the payment of ${rm(c.amount)}?`, body: 'The claim goes back to approved and the payment entry is removed.', confirmLabel: 'Undo paid' })) return
    const { error } = await supabase.rpc('unpay_claim', { p_id: c.id })
    if (error) toast(error.message, { kind: 'error' })
    load()
  }

  async function remove(c: Claim) {
    if (!await confirmDialog({ title: 'Cancel this claim?', body: `${c.description} · ${rm(c.amount)}`, confirmLabel: 'Cancel claim', danger: true })) return
    await supabase.from('claims').delete().eq('id', c.id)
    load()
  }

  const shown = tab === 'mine' ? claims.filter(c => c.staff_id === profile.id) : claims.filter(c => c.status === tab)
  const tabs: (Status | 'mine')[] = office ? ['pending', 'approved', 'paid', 'rejected', 'mine'] : []
  const approvedTotal = claims.filter(c => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0)

  return (
    <div className="space-y-4">
      <NewClaim onSaved={() => { setTab('mine'); load() }} />

      {office && (
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? 'tab-active' : ''}`}>
              {t === 'mine' ? 'My claims' : t[0].toUpperCase() + t.slice(1)}
              {t !== 'mine' && ` (${claims.filter(c => c.status === t).length})`}
            </button>
          ))}
        </div>
      )}
      {!office && <h3 className="font-semibold">My claims</h3>}

      {tab === 'approved' && canPay && shown.length > 0 && (
        <div className="card flex flex-wrap items-end gap-3">
          <div className="grow"><span className="font-semibold">{rm(approvedTotal)}</span> waiting to be paid</div>
          <div className="w-56">
            <label>Pay from</label>
            <select value={payFrom} onChange={e => setPayFrom(e.target.value)}>
              {MONEY_ACCOUNTS.map(code => <option key={code} value={code}>{MONEY_NAMES[code]}</option>)}
              {accounts.filter(a => isDirector(a.code)).map(a => <option key={a.code} value={a.code}>{a.name} (director paid)</option>)}
            </select>
          </div>
        </div>
      )}

      {shown.length === 0 && <div className="card p-0"><Empty text="Nothing here." /></div>}
      {shown.map(c => (
        <ClaimCard key={c.id} c={c} actions={<>
          {c.status === 'pending' && canReview(c) && rejecting !== c.id && <>
            <button className="btn" onClick={() => review(c, 'approved')}>Approve</button>
            <button className="btn-light" onClick={() => { setRejecting(c.id); setReason('') }}>Reject</button>
          </>}
          {c.status === 'pending' && canReview(c) && rejecting === c.id && (
            <div className="flex w-full flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1"><label>Why is it rejected?</label>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" autoFocus /></div>
              <button className="btn" onClick={() => review(c, 'rejected', reason)}>Confirm reject</button>
              <button className="btn-light" onClick={() => setRejecting(null)}>Cancel</button>
            </div>
          )}
          {c.status === 'approved' && canPay && <button className="btn" onClick={() => pay(c)}>Mark paid</button>}
          {c.status === 'paid' && canPay && <button className="btn-light" onClick={() => unpay(c)}>Undo paid</button>}
          {c.status === 'pending' && c.staff_id === profile.id && <button className="btn-light" onClick={() => remove(c)}>Cancel</button>}
        </>} />
      ))}
    </div>
  )
}
