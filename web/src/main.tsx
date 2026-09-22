import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

// The Supabase keys are baked in at build time. Without them the app cannot start,
// so say so plainly instead of showing a blank page.
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(
    <div className="p-6 max-w-lg mx-auto space-y-2">
      <h1 className="text-xl font-bold text-brand">Setup not finished</h1>
      <p>The website was built without its database keys.</p>
      <p>In Cloudflare, add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> as
        <b> build</b> variables (Settings → Build → Variables and secrets), then redeploy.</p>
    </div>,
  )
} else {
  import('./App.tsx').then(({ default: App }) => root.render(<StrictMode><App /></StrictMode>))
}
