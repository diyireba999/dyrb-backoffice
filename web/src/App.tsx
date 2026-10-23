import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  ArrowDownLeft, ArrowDownUp, ArrowLeftRight, ArrowUpRight, BookOpen, BookText, CalendarClock, ChevronDown, ChevronRight, FileText, HandCoins, KeyRound, LayoutDashboard,
  Building2, ListChecks, ListTree, LogOut, Menu, NotebookPen, Plus, Repeat, Search as SearchIcon, Settings2, CalendarDays, CloudUpload, CreditCard, IdCard, Package, Tags, Wallet2, PieChart, Receipt, Scale, SquareCheckBig, TrendingUp, Truck, Users as UsersIcon, Wallet, X,
  Columns3, type LucideIcon,
} from 'lucide-react'
import { isOffice, loginEmail, supabase, type Profile, type Role } from './lib'
import { JournalListing, OfficialReceipt, PaymentVoucher, Transfer } from './pages/Books'
import { AccountLedger, BankReconciliation, ChartOfAccounts, JournalEntry } from './pages/Ledger'
import { ApAging, PurchaseInvoices, Suppliers, SupplierPayments } from './pages/Purchase'
import { BalanceSheet, CashFlow, MonthlyPl, ProfitAndLoss, TrialBalance } from './pages/Reports'
import { Users, CompanyDetails } from './pages/Admin'
import { Claims } from './pages/Claims'
import { Dashboard } from './pages/Dashboard'
import { MonthEnd } from './pages/MonthEnd'
import { SearchDialog } from './Search'
import { ActionSlot } from './page'
import { ConfirmHost, Toasts } from './feedback'
import { SetupWarning } from './ui'
import { useLoading } from './lib'
import { Employees, MyPayslips, PayrollRun, PayrollSettings, PayrollYear, StaffAdvances, Timesheet } from './pages/Payroll'
import { CardSettlement, SalesSettings, UploadSales } from './pages/Sales'
import { ItemCosts, StockCount } from './pages/Stock'
import { Accruals } from './pages/Accruals'

const OFFICE: Role[] = ['owner', 'manager', 'accountant']
const EVERYONE: Role[] = [...OFFICE, 'staff']
const REPORTS: Role[] = [...OFFICE, 'investor']
const STAFF_ONLY: Role[] = ['staff']

// group = rail heading, in this order. Pages sharing a section show as one rail
// item (the first of them) with tabs on the page. URLs are unchanged.
type Page = { to: string; label: string; subtitle: string; icon: LucideIcon; group: string; section?: string; roles: Role[] }
const PAGES: Page[] = [
  { to: '/', label: 'Today', subtitle: 'Money, sales and what needs doing', icon: LayoutDashboard, group: 'Today', roles: [...EVERYONE, 'investor'] },

  { to: '/sales/upload', label: 'Upload', subtitle: 'Daily takings from the Zeoniq Bill Summary', icon: CloudUpload, group: 'Money in', section: 'Sales', roles: OFFICE },
  { to: '/sales/fiuu', label: 'Card settlement', subtitle: 'Fiuu payouts into the bank, and the fee', icon: CreditCard, group: 'Money in', section: 'Sales', roles: OFFICE },
  { to: '/cash/receipt', label: 'Official receipt', subtitle: 'Money received, other than daily sales (OR)', icon: ArrowDownLeft, group: 'Money in', roles: OFFICE },
  { to: '/cash/transfer', label: 'Transfer', subtitle: 'Move money between cash, e-wallet and bank (TR)', icon: ArrowLeftRight, group: 'Money in', roles: OFFICE },

  { to: '/ap/invoices', label: 'Invoices', subtitle: 'Supplier bills bought on credit (PI)', icon: FileText, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/payments', label: 'Pay suppliers', subtitle: 'Pay supplier invoices (SP)', icon: HandCoins, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/suppliers', label: 'Suppliers', subtitle: 'Supplier list and balance owed', icon: Truck, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/ap/aging', label: 'Aging', subtitle: 'Amount owed, by how overdue', icon: CalendarClock, group: 'Money out', section: 'Purchases', roles: OFFICE },
  { to: '/cash/payment', label: 'Payment voucher', subtitle: 'Pay out from cash or bank (PV)', icon: ArrowUpRight, group: 'Money out', roles: OFFICE },
  { to: '/claims', label: 'Claims', subtitle: 'Expenses paid from someone\'s own pocket', icon: Receipt, group: 'Money out', roles: EVERYONE },

  { to: '/month-end', label: 'Checklist', subtitle: 'Close the month, step by step', icon: ListChecks, group: 'Month-end', roles: OFFICE },
  { to: '/payroll/timesheet', label: 'Timesheet', subtitle: 'Hours worked each day, feeding the monthly payroll', icon: CalendarClock, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/advances', label: 'Advances', subtitle: 'Money lent before payday, taken back on the payslip', icon: HandCoins, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/run', label: 'Monthly run', subtitle: 'Work out pay, approve and print payslips', icon: CalendarDays, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payroll/year', label: 'Yearly summary', subtitle: 'Totals per staff for EA forms', icon: BookText, group: 'Month-end', section: 'Payroll', roles: OFFICE },
  { to: '/payslips', label: 'My payslips', subtitle: 'Your own payslips', icon: Wallet2, group: 'Month-end', roles: STAFF_ONLY },
  { to: '/gl/accruals', label: 'Accruals', subtitle: 'Rent and bills charged to the right month', icon: Repeat, group: 'Month-end', roles: OFFICE },
  { to: '/stock/count', label: 'Stock count', subtitle: 'Count the shelf and correct the cost', icon: Package, group: 'Month-end', roles: OFFICE },
  { to: '/cash/bank-rec', label: 'Bank reconciliation', subtitle: 'Match the books to the bank statement', icon: SquareCheckBig, group: 'Month-end', roles: OFFICE },

  { to: '/gl/listing', label: 'Documents', subtitle: 'All documents by month', icon: BookOpen, group: 'Books', roles: OFFICE },
  { to: '/gl/journal', label: 'Journal entry', subtitle: 'Manual debit / credit entry (JV)', icon: NotebookPen, group: 'Books', roles: OFFICE },
  { to: '/gl/ledger', label: 'All accounts', subtitle: 'Transactions and running balance of one account', icon: BookText, group: 'Books', section: 'Ledger', roles: OFFICE },
  { to: '/cash/book', label: 'Cash & bank', subtitle: 'Cash and bank movements with running balance', icon: Wallet, group: 'Books', section: 'Ledger', roles: OFFICE },
  { to: '/reports/pl', label: 'Profit & Loss', subtitle: 'Sales, costs and profit for a period', icon: TrendingUp, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/monthly', label: 'Monthly P&L', subtitle: 'Each month of the year side by side', icon: Columns3, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/bs', label: 'Balance sheet', subtitle: 'What the business owns and owes', icon: PieChart, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/cashflow', label: 'Cash flow', subtitle: 'Where the money came from and where it went', icon: ArrowDownUp, group: 'Books', section: 'Reports', roles: REPORTS },
  { to: '/reports/tb', label: 'Trial balance', subtitle: 'All account balances; debit equals credit', icon: Scale, group: 'Books', section: 'Reports', roles: REPORTS },

  { to: '/gl/accounts', label: 'Chart of accounts', subtitle: 'Account list and balances', icon: ListTree, group: 'Setup', roles: OFFICE },
  { to: '/payroll/staff', label: 'Staff', subtitle: 'Staff details, salary and deductions', icon: IdCard, group: 'Setup', roles: OFFICE },
  { to: '/stock/costs', label: 'Item costs', subtitle: 'What each drink and dish costs you', icon: Tags, group: 'Setup', roles: OFFICE },
  { to: '/sales/settings', label: 'Sales settings', subtitle: 'Where each payment type and sales figure goes', icon: Settings2, group: 'Setup', roles: OFFICE },
  { to: '/payroll/rates', label: 'Payroll settings', subtitle: 'EPF, SOCSO, EIS rates', icon: Settings2, group: 'Setup', roles: OFFICE },
  { to: '/company', label: 'Company details', subtitle: 'Name, SSM no. and address on printed reports', icon: Building2, group: 'Setup', roles: ['owner'] },
  { to: '/users', label: 'Users', subtitle: 'Who can sign in and what they can do', icon: UsersIcon, group: 'Setup', roles: ['owner'] },
]
const SECTION_ICONS: Record<string, LucideIcon> = { Sales: CloudUpload, Purchases: Truck, Payroll: CalendarDays, Ledger: BookText, Reports: TrendingUp }

// The "+ New" menu: forms for entering a document.
const NEW: { to: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { to: '/cash/payment', label: 'Payment', icon: ArrowUpRight, roles: OFFICE },
  { to: '/cash/receipt', label: 'Receipt', icon: ArrowDownLeft, roles: OFFICE },
  { to: '/cash/transfer', label: 'Transfer', icon: ArrowLeftRight, roles: OFFICE },
  { to: '/ap/invoices', label: 'Purchase Invoice', icon: FileText, roles: OFFICE },
  { to: '/gl/journal', label: 'Journal Entry', icon: NotebookPen, roles: OFFICE },
  { to: '/claims', label: 'Claim', icon: Receipt, roles: EVERYONE },
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
        <div className="text-xs text-slate-500">Accounting System</div>
      </div>
    </div>
  )
}

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(username), password })
    setBusy(false)
    if (error) setError('Wrong username or password')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="card space-y-5 p-8">
          <div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="muted mt-1">Use the username and password given to you.</p>
          </div>
          <div><label>Username</label><input autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} required /></div>
          <div><label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  )
}

// Change your own password (from the side menu).
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
        {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{msg}</p>}
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
  const { pathname } = useLocation()
  const current = pages.find(p => p.to === pathname)
  const [newOpen, setNewOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(() => { try { return localStorage.getItem('setupOpen') === '1' } catch { return false } })
  const toggleSetup = () => { setSetupOpen(!setupOpen); try { localStorage.setItem('setupOpen', setupOpen ? '0' : '1') } catch { /* private window */ } }
  const newItems = NEW.filter(n => n.roles.includes(profile.role))
  const groups = [...new Set(pages.map(p => p.group))]
  const go = () => { setNewOpen(false); onNavigate() }
  const initials = profile.full_name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const heading = 'px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400'
  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="px-5 pb-3 pt-5"><Logo /></div>
      <div className="space-y-2 px-3 pb-2">
        <button onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-500 hover:border-slate-300">
          <SearchIcon className="size-4" />Search
          <kbd className="ml-auto rounded border border-slate-200 bg-white px-1.5 text-[10px]">Ctrl K</kbd>
        </button>
        {newItems.length > 0 && <div>
          <button onClick={() => setNewOpen(!newOpen)} aria-expanded={newOpen} className="btn flex w-full items-center justify-center gap-2">
            <Plus className="size-4" />New<ChevronDown className={`size-4 transition ${newOpen ? 'rotate-180' : ''}`} />
          </button>
          {newOpen && <div className="mt-1 space-y-px rounded-lg border border-slate-200 p-1">
            {newItems.map(n => (
              <Link key={n.to} to={n.to} onClick={go} className="flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                <n.icon className="size-4 text-slate-400" />{n.label}
              </Link>
            ))}
          </div>}
        </div>}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {groups.map(g => {
          // One entry per section (its first tab), plus the pages that stand alone.
          const entries = pages.filter((p, i) => p.group === g && (!p.section || pages.findIndex(q => q.section === p.section) === i))
          const setup = g === 'Setup'
          const shown = !setup || setupOpen || current?.group === 'Setup'
          return (
            <div key={g}>
              {setup
                ? <button onClick={toggleSetup} aria-expanded={shown} className={`${heading} flex w-full items-center hover:text-slate-600`}>
                    {g}<ChevronRight className={`ml-auto size-3.5 transition ${shown ? 'rotate-90' : ''}`} />
                  </button>
                : g !== 'Today' && <div className={heading}>{g}</div>}
              {shown && <div className="space-y-px">
                {entries.map(p => {
                  const active = !!current && (p.section ? current.section === p.section : current.to === p.to)
                  const Icon = p.section ? SECTION_ICONS[p.section] : p.icon
                  return (
                    <Link key={p.to} to={p.to} onClick={go} aria-current={active ? 'page' : undefined}
                      className={`group flex h-8 items-center gap-3 rounded-lg px-3 text-[13px] transition ${
                        active ? 'bg-brand-soft font-medium text-brand-dark' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                      <Icon className={`size-4 ${active ? 'text-brand' : 'text-slate-400 group-hover:text-slate-600'}`} />{p.section ?? p.label}
                    </Link>
                  )
                })}
              </div>}
            </div>
          )
        })}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-semibold text-slate-700">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-900">{profile.full_name}</div>
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
  const [open, setOpen] = useState(false)        // phone drawer
  const [newSheet, setNewSheet] = useState(false) // phone "+ New" sheet
  const [search, setSearch] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)  // header action area, see page.tsx
  const { pathname } = useLocation()
  const pages = PAGES.filter(p => p.roles.includes(profile.role))
  // The title looks in every page, so an office login that opens /payslips still sees "My payslips"; the tabs only list pages this role can open.
  const page = PAGES.find(p => p.to === pathname) ?? pages[0]
  const tabs = page.section ? pages.filter(p => p.section === page.section) : []
  useEffect(() => { setOpen(false); setNewSheet(false) }, [pathname])
  const office = isOffice(profile.role)
  const newItems = NEW.filter(n => n.roles.includes(profile.role))
  const today = new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
  const hour = Number(new Date().toLocaleString('en-MY', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }))
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const barItem = 'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium'

  return (
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-58 lg:block">
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
      {newSheet && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setNewSheet(false)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">New</div>
            {newItems.map(n => (
              <Link key={n.to} to={n.to} onClick={() => setNewSheet(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] hover:bg-slate-100">
                <n.icon className="size-4 text-slate-400" />{n.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="lg:pl-58">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/70 bg-slate-50/80 px-4 py-3 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{pathname === '/' ? `${greeting}, ${profile.full_name.split(' ')[0]}` : page.section ?? page.label}</h1>
            <p className="truncate text-xs text-slate-500">{pathname === '/' ? today : page.subtitle}</p>
          </div>
          {/* Screens render their buttons here through <PageActions>. */}
          <div ref={setSlot} className="flex flex-wrap items-center gap-2 empty:hidden max-sm:basis-full" />
        </header>
        <SearchDialog pages={pages.map(p => p.section ? { ...p, label: `${p.section} · ${p.label}` } : p)} canSeeDocs={office} open={search} setOpen={setSearch} />
        <main className="mx-auto max-w-7xl p-4 pb-20 sm:p-6 lg:pb-6">
          {tabs.length > 1 && (
            <nav aria-label="Section" className="no-print -mt-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 [scrollbar-width:none]">
              {tabs.map(t => (
                <Link key={t.to} to={t.to} aria-current={t.to === pathname ? 'page' : undefined}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition ${
                    t.to === pathname ? 'border-brand font-medium text-brand-dark' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</Link>
              ))}
            </nav>
          )}
          <LoadingBar />
          <SetupWarning />
          <ActionSlot.Provider value={slot}>
            <Routes>
              <Route path="/" element={<Dashboard profile={profile} />} />
              <Route path="/claims" element={<Claims profile={profile} />} />
              <Route path="/payslips" element={<MyPayslips profile={profile} />} />
              {(office || profile.role === 'investor') && <>
                <Route path="/reports/tb" element={<TrialBalance />} />
                <Route path="/reports/pl" element={<ProfitAndLoss />} />
                <Route path="/reports/bs" element={<BalanceSheet />} />
                <Route path="/reports/monthly" element={<MonthlyPl />} />
                <Route path="/reports/cashflow" element={<CashFlow />} />
              </>}
              {office && <>
                <Route path="/month-end" element={<MonthEnd />} />
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
                <Route path="/sales/upload" element={<UploadSales role={profile.role} />} />
                <Route path="/sales/fiuu" element={<CardSettlement />} />
                <Route path="/sales/settings" element={<SalesSettings role={profile.role} />} />
                <Route path="/stock/costs" element={<ItemCosts role={profile.role} />} />
                <Route path="/stock/count" element={<StockCount role={profile.role} />} />
                <Route path="/payroll/staff" element={<Employees role={profile.role} />} />
                <Route path="/payroll/advances" element={<StaffAdvances role={profile.role} approver={profile.full_name} />} />
                <Route path="/payroll/timesheet" element={<Timesheet role={profile.role} />} />
                <Route path="/payroll/run" element={<PayrollRun role={profile.role} />} />
                <Route path="/payroll/year" element={<PayrollYear />} />
                <Route path="/payroll/rates" element={<PayrollSettings role={profile.role} />} />
              </>}
              {profile.role === 'owner' && <Route path="/users" element={<Users me={profile.id} />} />}
              {profile.role === 'owner' && <Route path="/company" element={<CompanyDetails />} />}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </ActionSlot.Provider>
        </main>
      </div>

      <nav aria-label="Phone" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Link to="/" className={`${barItem} ${pathname === '/' ? 'text-brand' : 'text-slate-500'}`}><LayoutDashboard className="size-5" />Today</Link>
        <button onClick={() => setSearch(true)} className={`${barItem} text-slate-500`}><SearchIcon className="size-5" />Search</button>
        <button onClick={() => setNewSheet(true)} disabled={newItems.length === 0} className={`${barItem} text-slate-500 disabled:opacity-40`}><Plus className="size-5" />New</button>
        <button onClick={() => setOpen(true)} className={`${barItem} text-slate-500`}><Menu className="size-5" />Menu</button>
      </nav>
      <Toasts />
      <ConfirmHost />
    </div>
  )
}

// Thin bar along the top while anything is loading or saving.
function LoadingBar() {
  return useLoading() ? <div className="no-print fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-brand" /> : null
}

export default function App() {
  const [session, setSession] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [needPassword, setNeedPassword] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(!!data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s))
    return () => data.subscription.unsubscribe()
  }, [])

  const [loadFailed, setLoadFailed] = useState('')

  useEffect(() => {
    if (!session) { setProfile(null); return }
    // A disabled login is refused by Supabase (getUser fails) or, mid-session, by its profile.
    const disabled = 'This login has been disabled. Ask the owner.'
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return setLoadFailed(disabled)
      supabase.from('profiles').select('*').eq('id', data.user.id).single()
        .then(({ data, error }) => {
          if (data?.active === false || error?.message?.includes('Not allowed')) return setLoadFailed(disabled)
          setProfile(data); if (error) setLoadFailed(error.message)
        })
    })
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
