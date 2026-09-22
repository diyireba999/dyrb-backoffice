import { useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { arrivedFromEmail, supabase, type Profile } from './lib'
import { Entries, MoneyIn, MoneyOut, Suppliers, Transfer } from './pages/Books'
import { Users } from './pages/Admin'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError('Wrong email or password')
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-brand">DYRB Back Office</h1>
        <div><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        <div><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {error && <p className="text-red-700 text-sm">{error}</p>}
        <button className="btn w-full" disabled={busy}>Sign in</button>
      </form>
    </div>
  )
}

// Invite and "forgot password" emails land here with a login link; person sets their own password.
function SetPassword({ done }: { done: () => void }) {
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return setMsg(error.message)
    done()
  }
  return (
    <form onSubmit={submit} className="card max-w-sm space-y-4">
      <h2 className="text-xl font-semibold">Set your password</h2>
      <div><label>New password (min 8)</label><input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></div>
      {msg && <p className="text-red-700 text-sm">{msg}</p>}
      <button className="btn w-full">Save password</button>
    </form>
  )
}

const TILES = [
  { to: '/money-out', title: 'Money Out', note: 'Supplier bills, expenses', office: true },
  { to: '/money-in', title: 'Money In', note: 'Other income, owner top-up', office: true },
  { to: '/transfer', title: 'Transfer', note: 'Cash to bank, petty cash', office: true },
  { to: '/entries', title: 'All Entries', note: 'See and check records', office: true },
  { to: '/suppliers', title: 'Suppliers', note: 'Add and edit suppliers', office: true },
]

function Home({ profile }: { profile: Profile }) {
  const office = profile.role !== 'staff'
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Hi, {profile.full_name}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {TILES.filter(t => office || !t.office).map(t => (
          <Link key={t.to} to={t.to} className="card hover:border-brand">
            <div className="text-lg font-semibold">{t.title}</div>
            <div className="text-sm text-stone-500">{t.note}</div>
          </Link>
        ))}
      </div>
      {!office && <p className="text-stone-500">Claims and payslips coming soon.</p>}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [needPassword, setNeedPassword] = useState(arrivedFromEmail)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(!!data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.auth.getUser().then(({ data }) =>
      supabase.from('profiles').select('*').eq('id', data.user!.id).single()
        .then(({ data }) => setProfile(data)))
  }, [session])

  if (session === null) return null
  if (!session) return <Login />
  if (!profile) return <p className="p-4">Loading…</p>
  if (needPassword) return <div className="p-4 grid place-items-center min-h-screen"><SetPassword done={() => setNeedPassword(false)} /></div>

  const office = profile.role !== 'staff'
  const nav = 'px-3 py-2 rounded-lg text-sm font-medium'
  return (
    <BrowserRouter>
      <header className="no-print bg-brand text-white">
        <div className="max-w-5xl mx-auto flex items-center gap-2 p-3 overflow-x-auto">
          <Link to="/" className="font-bold mr-2 whitespace-nowrap">DYRB</Link>
          {office && <NavLink to="/entries" className={nav}>Entries</NavLink>}
          {profile.role === 'owner' && <NavLink to="/users" className={nav}>Users</NavLink>}
          <button className={`${nav} ml-auto whitespace-nowrap`} onClick={() => setNeedPassword(true)}>Password</button>
          <button className={`${nav} whitespace-nowrap`} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-4">
        <Routes>
          <Route path="/" element={<Home profile={profile} />} />
          {office && <>
            <Route path="/money-out" element={<MoneyOut />} />
            <Route path="/money-in" element={<MoneyIn />} />
            <Route path="/transfer" element={<Transfer />} />
            <Route path="/entries" element={<Entries />} />
            <Route path="/suppliers" element={<Suppliers />} />
          </>}
          {profile.role === 'owner' && <Route path="/users" element={<Users />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
