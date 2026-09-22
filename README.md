# DYRB Back Office

Internal accounting, bookkeeping, payroll and claims for the bar & bistro.
Stack: React (Vite) on Cloudflare Pages + Supabase (database, login, receipt photos). All free tier.

## Setup guide (about 45 minutes, one time)

Use one email you control (e.g. the business email) for all three accounts.
Turn on two-step login for each account once created — this system holds salary and bank data.

### Step 1 – Put the code on GitHub
1. Go to https://github.com/signup and create a free account.
2. Top right **+** → **New repository**. Name `dyrb-backoffice`, choose **Private**, do not tick "Add a README". Click **Create repository**.
3. Open a terminal in this folder (`C:\Users\DELL\Documents\DYRB Accounting`) and run, replacing `YOUR-NAME`:
   ```
   git remote add origin https://github.com/YOUR-NAME/dyrb-backoffice.git
   git push -u origin master
   ```
   A browser window asks you to sign in to GitHub the first time — approve it.
4. Refresh the GitHub page; you should see the `web` and `supabase` folders.

### Step 2 – Create the database on Supabase
1. Go to https://supabase.com → **Start your project** → sign up with GitHub (easiest).
2. **New project**:
   - Name: `dyrb-backoffice`
   - Database password: click **Generate**, then save it somewhere safe (password manager).
   - Region: **Southeast Asia (Singapore)**
   - Plan: Free → **Create new project**. Wait about 2 minutes.
3. Left menu **SQL Editor** → **New query**. Open `supabase/001_core.sql` in Notepad, copy everything, paste, click **Run**. It should say "Success. No rows returned".
4. **New query** again → paste `supabase/002_claims.sql` → **Run**.
   Then the same for `supabase/003_accounting.sql`.
5. Left menu **Authentication** → **Sign In / Providers**: turn **off** "Allow new users to sign up", **Save**. Only you can add people.
6. Still in Authentication → **Users** → **Add user** → **Create new user**: your email + a strong password, tick **Auto Confirm User** → **Create user**.
7. Back to **SQL Editor** → New query → paste (with your name and email) → **Run**:
   ```sql
   update profiles set role = 'owner', full_name = 'Your Name'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
8. Get the two keys: click **Connect** at the top of the project (or **Project Settings → API Keys**):
   - **Project URL** – looks like `https://abcd1234.supabase.co`
   - **Publishable key** (or legacy **anon public** key) – long text.
   Keep this page open for Step 3. Never put the **secret / service_role** key in the website.

### Step 3 – Put the website online with Cloudflare Pages
1. Go to https://dash.cloudflare.com/sign-up and create a free account.
2. Left menu **Workers & Pages** → **Create** → **Pages** tab → **Import an existing Git repository** → connect GitHub → allow access to `dyrb-backoffice` only → select it → **Begin setup**.
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory (Advanced): `web`
4. **Environment variables** → add:
   - `VITE_SUPABASE_URL` = Project URL from Step 2.8
   - `VITE_SUPABASE_ANON_KEY` = Publishable/anon key from Step 2.8
5. **Save and Deploy**. Wait 1–2 minutes. You get a link like `https://dyrb-backoffice.pages.dev`.
6. Back in Supabase → **Authentication → URL Configuration** → **Site URL** = that link → **Save**.

### Step 4 – First login and setup
1. Open the link on your phone and computer, sign in with the Step 2.6 email and password.
2. **Suppliers** → add your regular suppliers. If you already owe one, fill "Already owe them?" and the date.
3. Opening balances (use the day before your start date):
   - Bank / cash on hand: **Money In** → Type *Owner Capital* → Received into Bank / Cash in Drawer / Petty Cash.
   - Deposits already paid (rent, TNB, water): **Money Out** → What for *Deposits Paid* → Paid from *Owner paid personally*.
4. Add staff: Supabase → Authentication → Users → **Add user → Create new user** (tick Auto Confirm) with a temporary password. They sign in and press **Password** to change it. Then in the app **Users**, set their name and role.

### Everyday notes
- Every change pushed to GitHub updates the website automatically.
- Supabase free projects pause after 7 days without use — normal daily use keeps it awake. If paused, open Supabase and click **Restore**.
- Supabase free has no automatic backups (coming in Phase 6). Until then, once a month: Supabase → Table Editor → each table → export to CSV.

## Run on this computer (optional, for testing changes)

```
cd web
copy .env.example .env.local   (then fill in the two values)
npm install
npm run dev
```

`npm run test:db` checks the database rules (entries must balance, no double posting, claims, supplier balances, delete rights).

## Status
- [x] Phase 1 – login, roles, chart of accounts
- [x] Phase 2 – Accounting: Chart of Accounts, Journal Entry, General Ledger, Cash Book (PV / OR / Transfer), Bank Reconciliation, Purchase (Suppliers, Purchase Invoice, Supplier Payment, Aging), Trial Balance, Profit & Loss, Balance Sheet
- [ ] Phase 3 – Upload Sales (Zeoniq) + Fiuu settlement — **need sample export files**
- [x] Phase 4 – Claims (staff submit with photo, manager approves, owner/accountant pays)
- [ ] Phase 5 – Payroll
- [ ] Phase 6 – Reports, SST, backups
