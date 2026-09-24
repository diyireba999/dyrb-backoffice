import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, BookText, CalendarClock, FileText, HandCoins, KeyRound, LayoutDashboard,
  ListTree, LogOut, Menu, NotebookPen, Repeat, Search as SearchIcon, Settings2, CalendarDays, CloudUpload, CreditCard, IdCard, Package, Tags, Wallet2, PieChart, Receipt, Scale, SquareCheckBig, TrendingUp, Truck, Users as UsersIcon, Wallet, X,
  type LucideIcon,
} from 'lucide-react'
import { arrivedFromEmail, supabase, type Profile, type Role } from './lib'
import { JournalListing, OfficialReceipt, PaymentVoucher, Transfer } from './pages/Books'
import { AccountLedger, BankReconciliation, ChartOfAccounts, JournalEntry } from './pages/Ledger'
import { ApAging, PurchaseInvoices, Suppliers, SupplierPayments } from './pages/Purchase'
import { BalanceSheet, ProfitAndLoss, TrialBalance } from './pages/Reports'
import { Users } from './pages/Admin'
import { Claims } from './pages/Claims'
import { Dashboard } from './pages/Dashboard'
import { SearchDialog } from './Search'
import { SetupWarning } from './ui'
import { Employees, MyPayslips, PayrollRun, PayrollSettings, PayrollYear } from './pages/Payroll'
import { CardSettlement, SalesSettings, UploadSales } from './pages/Sales'
import { ItemCosts, StockCount } from './pages/Stock'
import { Accruals } from './pages/Accruals'

const OFFICE: Role[] = ['owner', 'manager', 'accountant']
const EVERYONE: Role[] = [...OFFICE, 'staff']

type Page = { to: string; label: string; subtitle: string; icon: LucideIcon; group: string; roles: Role[] }
const PAGES: Page[] = [
  { to: '/', label: 'Dashboard', subtitle: 'Overview of money and tasks', icon: LayoutDashboard, group: 'Overview', roles: EVERYONE },
  { to: '/gl/accounts', label: 'Chart of Accounts', subtitle: 'Account list and balances', icon: ListTree, group: 'General Ledger', roles: OFFICE },
  { to: '/gl/journal', label: 'Journal Entry', subtitle: 'Manual debit / credit entry (JV)', icon: NotebookPen, group: 'General Ledger', roles: OFFICE },
  { to: '/gl/listing', label: 'Journal Listing', subtitle: 'All documents by month', icon: BookOpen, group: 'General Ledger', roles: OFFICE },
  { to: '/gl/accruals', label: 'Monthly Accruals', subtitle: 'Rent and bills charged to the right month', icon: Repeat, group: 'General Ledger', roles: OFFICE },
  { to: '/gl/ledger', label: 'General Ledger', subtitle: 'Transactions and running balance of one account', icon: BookText, group: 'General Ledger', roles: OFFICE },
  { to: '/sales/upload', label: 'Upload Sales', subtitle: 'Daily takings from the Zeoniq Bill Summary', icon: CloudUpload, group: 'Sales', roles: OFFICE },
  { to: '/sales/fiuu', label: 'Card Settlement', subtitle: 'Fiuu payouts into the bank, and the fee', icon: CreditCard, group: 'Sales', roles: OFFICE },
  { to: '/stock/costs', label: 'Item Costs', subtitle: 'What each drink and dish costs you', icon: Tags, group: 'Sales', roles: OFFICE },
  { to: '/stock/count', label: 'Stock Count', subtitle: 'Count the shelf and correct the cost', icon: Package, group: 'Sales', roles: OFFICE },
  { to: '/sales/settings', label: 'Sales Settings', subtitle: 'Where each payment type and sales figure goes', icon: Settings2, group: 'Sales', roles: OFFICE },
  { to: '/cash/payment', label: 'Payment Voucher', subtitle: 'Pay out from cash or bank (PV)', icon: ArrowUpRight, group: 'Cash Book', roles: OFFICE },
  { to: '/cash/receipt', label: 'Official Receipt', subtitle: 'Money received, other than daily sales (OR)', icon: ArrowDownLeft, group: 'Cash Book', roles: OFFICE },
  { to: '/cash/transfer', label: 'Bank Transfer', subtitle: 'Move money between cash and bank (TR)', icon: ArrowLeftRight, group: 'Cash Book', roles: OFFICE },
  { to: '/cash/book', label: 'Cash Book', subtitle: 'Cash and bank movements with running balance', icon: Wallet, group: 'Cash Book', roles: OFFICE },
  { to: '/cash/bank-rec', label: 'Bank Reconciliation', subtitle: 'Match the books to the bank statement', icon: SquareCheckBig, group: 'Cash Book', roles: OFFICE },
  { to: '/ap/suppliers', label: 'Suppliers', subtitle: 'Supplier list and balance owed', icon: Truck, group: 'Purchase', roles: OFFICE },
  { to: '/ap/invoices', label: 'Purchase Invoice', subtitle: 'Supplier bills bought on credit (PI)', icon: FileText, group: 'Purchase', roles: OFFICE },
  { to: '/ap/payments', label: 'Supplier Payment', subtitle: 'Pay supplier invoices (SP)', icon: HandCoins, group: 'Purchase', roles: OFFICE },
  { to: '/ap/aging', label: 'Supplier Aging', subtitle: 'Amount owed, by how overdue', icon: CalendarClock, group: 'Purchase', roles: OFFICE },
  { to: '/claims', label: 'Claims', subtitle: 'Staff expense claims', icon: Receipt, group: 'Team', roles: EVERYONE },
  { to: '/payslips', label: 'My Payslips', subtitle: 'Your own payslips', icon: Wallet2, group: 'Team', roles: EVERYONE },
  { to: '/payroll/staff', label: 'Staff', subtitle: 'Staff details, salary and deductions', icon: IdCard, group: 'Payroll', roles: OFFICE },
  { to: '/payroll/run', label: 'Monthly Payroll', subtitle: 'Work out pay, approve and print payslips', icon: CalendarDays, group: 'Payroll', roles: OFFICE },
  { to: '/payroll/year', label: 'Yearly Summary', subtitle: 'Totals per staff for EA forms', icon: BookText, group: 'Payroll', roles: OFFICE },
  { to: '/payroll/rates', label: 'Payroll Settings', subtitle: 'EPF, SOCSO, EIS rates', icon: Settings2, group: 'Payroll', roles: OFFICE },
  { to: '/reports/tb', label: 'Trial Balance', subtitle: 'All account balances; debit equals credit', icon: Scale, group: 'Reports', roles: OFFICE },
  { to: '/reports/pl', label: 'Profit & Loss', subtitle: 'Sales, costs and profit for a period', icon: TrendingUp, group: 'Reports', roles: OFFICE },
  { to: '/reports/bs', label: 'Balance Sheet', subtitle: 'What the business owns and owes', icon: PieChart, group: 'Reports', roles: OFFICE },
  { to: '/users', label: 'Users', subtitle: 'Who can sign in and what they can do', icon: UsersIcon, group: 'Settings', roles: ['owner'] },
]

// Put your logo at web/public/logo.png and it replaces the "DY" mark automatically.
function Logo() {
  const [img, setImg] = useState(true)
  return (
    <div className="flex items-center gap-3">
      {img
        ? <img src="/logo.png" alt="" className="size-9 rounded-lg object-contain" onError={() => setImg(false)} />
        : <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white shadow-sm">DY</div>}
      <div className="leading-tight">
        <div className="font-semibold text-slate-900">DYRB</div>
        <div className="text-xs text-slate-500">Back Office</div>
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

function Sidebar({ profile, pages, onNavigate, onPassword, onSearch }: {
  profile: Profile; pages: Page[]; onNavigate: () => void; onPassword: () => void; onSearch: () => void
}) {
  const groups = [...new Set(pages.map(p => p.group))]
  const initials = profile.full_name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="px-5 pb-3 pt-5"><Logo /></div>
      <div className="px-3 pb-2">
        <button onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 hover:border-slate-300">
          <SearchIcon className="size-4" />Search
          <kbd className="ml-auto rounded border border-slate-200 bg-white px-1.5 text-[10px]">Ctrl K</kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {groups.map(g => (
          <div key={g}>
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</div>
            <div className="space-y-px">
              {pages.filter(p => p.group === g).map(p => (
                <NavLink key={p.to} to={p.to} end onClick={onNavigate}
                  className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive ? 'bg-brand-soft font-medium text-brand-dark' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                  {({ isActive }) => <><p.icon className={`size-4 ${isActive ? 'text-brand' : 'text-slate-400 group-hover:text-slate-600'}`} />{p.label}</>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-semibold text-slate-700">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{profile.full_name}</div>
            <div className="text-xs capitalize text-slate-500">{profile.role}</div>
          </div>
          <button title="Change password" onClick={onPassword} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><KeyRound className="size-4" /></button>
          <button title="Sign out" onClick={() => supabase.auth.signOut()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><LogOut className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}

function Shell({ profile, onPassword }: { profile: Profile; onPassword: () => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(false)
  const { pathname } = useLocation()
  const pages = PAGES.filter(p => p.roles.includes(profile.role))
  const page = pages.find(p => p.to === pathname) ?? pages[0]
  const office = profile.role !== 'staff'
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const hour = Number(new Date().toLocaleString('en-MY', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 lg:block">
        <Sidebar profile={profile} pages={pages} onNavigate={() => {}} onPassword={onPassword} onSearch={() => setSearch(true)} />
      </aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar profile={profile} pages={pages} onNavigate={() => setOpen(false)} onPassword={onPassword} onSearch={() => { setOpen(false); setSearch(true) }} />
          </div>
          <button className="absolute left-72 top-3 ml-2 rounded-md bg-white p-2 text-slate-700 shadow" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-slate-50/80 px-4 backdrop-blur-md sm:px-8">
          <button className="-ml-1 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{pathname === '/' ? `${greeting}, ${profile.full_name.split(' ')[0]}` : page.label}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{pathname === '/' ? today : page.subtitle}</p>
          </div>
          <button onClick={() => setSearch(true)} className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Search"><SearchIcon className="size-5" /></button>
        </header>
        <SearchDialog pages={pages} canSeeDocs={office} open={search} setOpen={setSearch} />
        <main className="mx-auto max-w-7xl p-4 sm:p-8">
          <SetupWarning />
          <Routes>
            <Route path="/" element={<Dashboard profile={profile} />} />
            <Route path="/claims" element={<Claims profile={profile} />} />
            <Route path="/payslips" element={<MyPayslips profile={profile} />} />
            {office && <>
              <Route path="/gl/accounts" element={<ChartOfAccounts role={profile.role} />} />
              <Route path="/gl/journal" element={<JournalEntry />} />
              <Route path="/gl/listing" element={<JournalListing isOwner={profile.role === 'owner'} />} />
              <Route path="/gl/ledger" element={<AccountLedger />} />
              <Route path="/gl/accruals" element={<Accruals role={profile.role} />} />
              <Route path="/cash/payment" element={<PaymentVoucher />} />
              <Route path="/cash/receipt" element={<OfficialReceipt />} />
              <Route path="/cash/transfer" element={<Transfer />} />
              <Route path="/cash/book" element={<AccountLedger key="cash" moneyOnly />} />
              <Route path="/cash/bank-rec" element={<BankReconciliation />} />
              <Route path="/ap/suppliers" element={<Suppliers />} />
              <Route path="/ap/invoices" element={<PurchaseInvoices role={profile.role} />} />
              <Route path="/ap/payments" element={<SupplierPayments role={profile.role} />} />
              <Route path="/ap/aging" element={<ApAging />} />
              <Route path="/reports/tb" element={<TrialBalance />} />
              <Route path="/reports/pl" element={<ProfitAndLoss />} />
              <Route path="/reports/bs" element={<BalanceSheet />} />
              <Route path="/sales/upload" element={<UploadSales />} />
              <Route path="/sales/fiuu" element={<CardSettlement />} />
              <Route path="/sales/settings" element={<SalesSettings role={profile.role} />} />
              <Route path="/stock/costs" element={<ItemCosts role={profile.role} />} />
              <Route path="/stock/count" element={<StockCount role={profile.role} />} />
              <Route path="/payroll/staff" element={<Employees role={profile.role} />} />
              <Route path="/payroll/run" element={<PayrollRun role={profile.role} />} />
              <Route path="/payroll/year" element={<PayrollYear />} />
              <Route path="/payroll/rates" element={<PayrollSettings role={profile.role} />} />
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

  const [loadFailed, setLoadFailed] = useState('')

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.auth.getUser().then(({ data }) =>
      supabase.from('profiles').select('*').eq('id', data.user!.id).single()
        .then(({ data, error }) => { setProfile(data); if (error) setLoadFailed(error.message) }))
  }, [session])

  if (session === null) return null
  if (!session) return <Login />
  if (!profile) return (
    <div className="grid min-h-screen place-items-center p-4">
      {loadFailed ? (
        <div className="card max-w-sm space-y-3 text-center">
          <p className="font-semibold">Could not open your account</p>
          <p className="muted">{loadFailed}</p>
          <button className="btn w-full" onClick={() => supabase.auth.signOut()}>Sign out and try again</button>
        </div>
      ) : <p className="muted">Loading…</p>}
    </div>
  )
  if (needPassword) return <SetPassword done={() => setNeedPassword(false)} />

  return (
    <BrowserRouter>
      <Shell profile={profile} onPassword={() => setNeedPassword(true)} />
    </BrowserRouter>
  )
}
