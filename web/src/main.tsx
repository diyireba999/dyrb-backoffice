import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// A crash anywhere used to leave a blank white page. Show what broke instead,
// so it can be reported, with a way back.
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 max-w-lg mx-auto space-y-3">
        <h1 className="text-xl font-bold text-brand">Something went wrong on this page</h1>
        <p>Anything not yet saved on that screen is lost. Please send this message to whoever looks after the system:</p>
        <pre className="whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs">{this.state.error.message}</pre>
        <button className="btn" onClick={() => location.reload()}>Reload the page</button>
      </div>
    )
  }
}

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
  import('./App.tsx').then(({ default: App }) => root.render(<StrictMode><CrashScreen><App /></CrashScreen></StrictMode>))
}
