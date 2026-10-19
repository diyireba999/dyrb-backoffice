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

> **If a paste gets cut short**, part of a file will be missing and reports show zero.
> Run `supabase/003b_repair.sql` — it is safe to run any time and creates whatever is missing.

1. Go to https://supabase.com → **Start your project** → sign up with GitHub (easiest).
2. **New project**:
   - Name: `dyrb-backoffice`
   - Database password: click **Generate**, then save it somewhere safe (password manager).
   - Region: **Southeast Asia (Singapore)**
   - Plan: Free → **Create new project**. Wait about 2 minutes.
3. Left menu **SQL Editor** → **New query**. Open `supabase/001_core.sql` in Notepad, copy everything, paste, click **Run**. It should say "Success. No rows returned".
4. **New query** again → paste `supabase/002_claims.sql` → **Run**.
   Then the same for every other file in the `supabase` folder, in number order: `003_accounting.sql`, `004_payroll.sql` … up to the highest number there is (`031_review_fixes.sql` at the time of writing). Skip `003b_repair.sql` unless a paste was cut short.
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
4. Add staff in the app: **Users** → fill in name, username, a first password and the role → **Add person**. Tell them the username and password; they can change the password from the key icon in the side menu.
5. Backups: in GitHub, repo **Settings → Secrets and variables → Actions → New repository secret**, name `SUPABASE_DB_URL`, value = the **Session pooler** connection string from Supabase → **Connect**. Every night `.github/workflows/backup.yml` then saves a copy of the whole database under the repo's **Actions** tab (kept 30 days). Run it once by hand from **Actions → Nightly database backup → Run workflow** to check it works.

### Everyday notes
- Every change pushed to GitHub updates the website automatically.
- Supabase free projects pause after 7 days without use — normal daily use keeps it awake. If paused, open Supabase and click **Restore**.
- A wrong Payment Voucher, Official Receipt, Transfer or Journal Entry can be re-opened from its own screen and corrected — it keeps the same document number. Documents older than three months: press **Show older than 3 months** on that screen, or open them from **Documents**. An entry already ticked on the Bank Reconciliation must be unticked there first.
- After pulling in a code update, also check whether a new file has appeared in the `supabase` folder (for example `supabase/031_review_fixes.sql`) and run it in Supabase → SQL Editor, same as Step 2.3–2.4. Pushing to GitHub updates the website by itself, but it does not touch the database — until the new file is run, the affected screens will look empty or a button will show an error, even though nothing was lost.
- Days uploaded without the Product Sales file, or with an item code that is not in Sales Settings yet, are posted to **4090 Sales (unsplit)**. Load the product file later, tick those days and press **Re-split** to move them into food, beverage and liquor.
- Cash drawer short or over after banking, and monthly depreciation, are typed as a Journal Entry: **6910 Cash Over / Short** against the cash account, and **6950 Depreciation** against **1590 Accumulated Depreciation**.
- A salary advance is recorded on the Staff Advance screen; the money leaves the till straight away and comes off the next payslip by itself, and if it is more than one month's pay the rest carries to the month after.
- Hours go on the Timesheet before the monthly payroll is created; creating the run picks them up, and anything can still be corrected on the payslip before approving.
- **Today** lists what is waiting: sales days not uploaded (press the date if the bar was closed), card money not yet settled, payroll to approve or pay, and last month's close. **Month-end › Checklist** walks the nine steps of closing a month and lets you mark it closed; closing is a note for you, it does not lock anything.
- After pulling this update run `supabase/032_month_status.sql` in Supabase → SQL Editor, or Today and the Checklist will show "Could not check the month".
- The dashboard's sales figures compare against the same day of the week a week ago (Tuesday vs Tuesday, not Tuesday vs Monday), because trade swings by day of week. Its break-even figure is worked out from the last two or three complete months of records, whichever there is, so it settles down and becomes more reliable once there is a few months of history.
- The side menu is grouped by task: **Today**, **Money in**, **Money out**, **Month-end**, **Books**, **Setup**. On a phone the bottom bar has Today, Search, New and Menu. Every screen keeps its old web address, so bookmarks still work.
- After saving a voucher, receipt, transfer, invoice or journal, the list comes back with the new row highlighted; press **Save & add another** to stay on the form. Esc closes a form.

## Run on this computer (optional, for testing changes)

```
cd web
copy .env.example .env.local   (then fill in the two values)
npm install
npm run dev
```

`npm run test:db` checks the database rules (entries must balance, no double posting, claims, supplier balances, payroll, daily sales).
`npm run test:sales -- <file.xlsx>` checks a Zeoniq Bill Summary export adds up before importing.
`npm run test:rls` checks what each role can see and do.
`npm run test:repair` checks the repair file on a half-applied and on a complete database.
`npm run test:dash` checks the dashboard's arithmetic (date ranges, percentage changes, break-even).

If you build the site on this computer (`npm run build`) without doing the `.env.local` step above, it will finish with no errors but the site it makes will be empty — it quietly leaves the whole app out. Always copy `.env.example` to `.env.local` and fill in the two values before trusting a build made here. Cloudflare's own builds already have these values set, so they are not affected.

## Status
- [x] Phase 1 – login, roles, chart of accounts
- [x] Phase 2 – Accounting: Chart of Accounts, Journal Entry, General Ledger, Cash Book (PV / OR / Transfer), Bank Reconciliation, Purchase (Suppliers, Purchase Invoice, Supplier Payment, Aging), Trial Balance, Profit & Loss, Balance Sheet
- [x] Phase 3a – Upload Sales from the Zeoniq Bill Summary
- [x] Phase 3b – Fiuu card settlements into the bank, with the fee
- [x] Phase 3c – Food / beverage / liquor split from the Zeoniq Product Sales export
- [x] Phase 4 – Claims (staff submit with photo, manager approves, owner/accountant pays)
- [x] Phase 5 – Payroll (staff records, monthly run, EPF/SOCSO/EIS, payslips, yearly summary, salary advances, timesheets)
- [ ] Phase 6 – Dashboard showing money due, a weekday-matched sales trend, break-even and margin health; reports, SST, backups still to come
