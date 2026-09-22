# DYRB Back Office

Internal accounting, bookkeeping, payroll and claims for the bar & bistro.
Stack: React (Vite) on Cloudflare Pages + Supabase (database, login, receipt photos). All free tier.

## One-time setup (owner does these — about 30 minutes)

1. **GitHub** – create a free account, create a *private* repo `dyrb-backoffice`, push this folder.
2. **Supabase** – create a free account and a new project (region: **Singapore**).
   - SQL Editor → paste `supabase/001_core.sql` → Run.
   - Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up" (internal only).
   - Authentication → Users → **Invite user** (your own email). Accept the email and set a password.
   - SQL Editor → make yourself owner:
     `update profiles set role = 'owner' where id = (select id from auth.users where email = 'you@example.com');`
   - Project Settings → API → copy **Project URL** and **anon public key**.
3. **Cloudflare Pages** – free account → Workers & Pages → Create → Pages → connect GitHub repo.
   - Root directory: `web` · Build command: `npm run build` · Output: `dist`
   - Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (from step 2).
   - `web/public/_redirects` is already included so page refresh works.
4. Supabase → Authentication → URL Configuration → **Site URL** = your `https://xxxx.pages.dev` link (so invite emails open the app).
5. Open the link, sign in.

## Run on this computer

```
cd web
copy .env.example .env.local   (then fill in the two values)
npm install
npm run dev
```

`npm run test:db` checks the database rules (entries must balance, no double posting, staff blocked).

## Adding people
Supabase → Authentication → Invite user. They appear in **Users** as Staff; owner sets the role.

## Status
- [x] Phase 1 – login, roles, chart of accounts
- [x] Phase 2 – Money In / Money Out / Transfer / Suppliers / All Entries
- [ ] Phase 3 – Upload Sales (Zeoniq) + Fiuu settlement — **need sample export files**
- [ ] Phase 4 – Claims
- [ ] Phase 5 – Payroll
- [ ] Phase 6 – Reports, SST, backups
