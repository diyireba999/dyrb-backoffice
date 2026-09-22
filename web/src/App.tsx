import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, KeyRound, LayoutDashboard, LogOut, Menu, Receipt, Truck, Users as UsersIcon, X,
  type LucideIcon,
} from 'lucide-react'
import { arrivedFromEmail, supabase, type Profile, type Role } from './lib'
import { Entries, MoneyIn, MoneyOut, Suppliers, Transfer } from './pages/Books'
import { Users } from './pages/Admin'
import { Claims } from './pages/Claims'
import { Dashboard } from './pages/Dashboard'

const OFFICE: Role[] = ['owner', 'manager', 'accountant']
const EVERYONE: Role[] = [...OFFICE, 'staff']

type Page = { to: string; label: string; subtitle: string; icon: LucideIcon; group: string; roles: Role[] }
const PAGES: Page[] = [
  { to: '/', label: 'Dashboard', subtitle: 'Overview of money and tasks', icon: LayoutDashboard, group: 'Overview', roles: EVERYONE },
  { to: '/money-out', label: 'Money Out', subtitle: 'Supplier bills and expenses', icon: ArrowUpRight, group: 'Books', roles: OFFICE },
  { to: '/money-in', label: 'Money In', subtitle: 'Income other than daily sales', icon: ArrowDownLeft, group: 'Books', roles: OFFICE },
  { to: '/transfer', label: 'Transfer', subtitle: 'Move money between cash and bank', icon: ArrowLeftRight, group: 'Books', roles: OFFICE },
  { to: '/entries', label: 'All Entries', subtitle: 'Every record, by month', icon: BookOpen, group: 'Books', roles: OFFICE },
  { to: '/suppliers', label: 'Suppliers', subtitle: 'Supplier list and amounts owed', icon: Truck, group: 'Books', roles: OFFICE },
  { to: '/claims', label: 'Claims', subtitle: 'Staff expense claims', icon: Receipt, group: 'Team', roles: EVERYONE },
  { to: '/users', label: 'Users', subtitle: 'Who can sign in and what they can do', icon: UsersIcon, group: 'Settings', roles: ['owner'] },
]

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-9 place-items-center rounded-lg bg-brand text-sm font-bold text-white">DY</div>
      <div className="leading-tight">
        <div className={`font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>DYRB</div>
        <div className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Back Office</div>
      </div>
    </div>
  )
}

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
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="card space-y-5 p-8">
          <div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="muted mt-1">Use the email and password given to you.</p>
          </div>
          <div><label>Email</label><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
          <div><label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
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
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-8">
        <div>
          <h1 className="text-xl font-semibold">Set your password</h1>
          <p className="muted mt-1">At least 8 characters.</p>
        </div>
        <div><label>New password</label><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></div>
        {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-light flex-1" onClick={done}>Cancel</button>
          <button className="btn flex-1">Save password</button>
        </div>
      </form>
    </div>
  )
}

function Sidebar({ profile, pages, onNavigate, onPassword }: {
  profile: Profile; pages: Page[]; onNavigate: () => void; onPassword: () => void
}) {
  const groups = [...new Set(pages.map(p => p.group))]
  const initials = profile.full_name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="px-5 py-5"><Logo dark /></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {groups.map(g => (
          <div key={g}>
            <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</div>
            <div className="space-y-0.5">
              {pages.filter(p => p.group === g).map(p => (
                <NavLink key={p.to} to={p.to} end onClick={onNavigate}
                  className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'}`}>
                  <p.icon className="size-4" />{p.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-white">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{profile.full_name}</div>
            <div className="text-xs capitalize text-slate-400">{profile.role}</div>
          </div>
          <button title="Change password" onClick={onPassword} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><KeyRound className="size-4" /></button>
          <button title="Sign out" onClick={() => supabase.auth.signOut()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}

function Shell({ profile, onPassword }: { profile: Profile; onPassword: () => void }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const pages = PAGES.filter(p => p.roles.includes(profile.role))
  const page = pages.find(p => p.to === pathname) ?? pages[0]
  const office = profile.role !== 'staff'
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Sidebar profile={profile} pages={pages} onNavigate={() => {}} onPassword={onPassword} />
      </aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar profile={profile} pages={pages} onNavigate={() => setOpen(false)} onPassword={onPassword} />
          </div>
          <button className="absolute left-72 top-3 ml-2 rounded-md p-2 text-white" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="-ml-1 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{pathname === '/' ? `Welcome back, ${profile.full_name.split(' ')[0]}` : page.label}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{page.subtitle}</p>
          </div>
          <div className="ml-auto hidden text-sm text-slate-500 md:block">{today}</div>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">
          <Routes>
            <Route path="/" element={<Dashboard profile={profile} />} />
            <Route path="/claims" element={<Claims profile={profile} />} />
            {office && <>
              <Route path="/money-out" element={<MoneyOut />} />
              <Route path="/money-in" element={<MoneyIn />} />
              <Route path="/transfer" element={<Transfer />} />
              <Route path="/entries" element={<Entries isOwner={profile.role === 'owner'} />} />
              <Route path="/suppliers" element={<Suppliers />} />
            </>}
            {profile.role === 'owner' && <Route path="/users" element={<Users me={profile.id} />} />}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
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
  if (!profile) return <div className="grid min-h-screen place-items-center muted">Loading…</div>
  if (needPassword) return <SetPassword done={() => setNeedPassword(false)} />

  return (
    <BrowserRouter>
      <Shell profile={profile} onPassword={() => setNeedPassword(true)} />
    </BrowserRouter>
  )
}
