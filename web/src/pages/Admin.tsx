import { useEffect, useState } from 'react'
import { supabase, type Profile, type Role } from '../lib'

const ROLES: Role[] = ['owner', 'manager', 'accountant', 'staff', 'investor']

// Owner adds people here with a username and first password (022_usernames.sql).
export function Users({ me }: { me: string }) {
  const [list, setList] = useState<Profile[]>([])
  const [add, setAdd] = useState({ username: '', full_name: '', role: 'staff' as Role, password: '' })
  const load = () => { supabase.from('profiles').select('*').order('full_name').then(({ data }) => setList(data ?? [])) }
  useEffect(load, [])

  async function update(id: string, patch: Partial<Profile>) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) alert(error.message)
    load()
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('create_login', {
      p_username: add.username, p_full_name: add.full_name, p_role: add.role, p_password: add.password,
    })
    if (error) return alert(error.message)
    alert(`Added. ${add.full_name} signs in as "${add.username.trim().toLowerCase()}" with the password you set.`)
    setAdd({ username: '', full_name: '', role: 'staff', password: '' })
    load()
  }

  async function resetPassword(p: Profile) {
    const password = prompt(`New password for ${p.full_name} (at least 8 characters):`)
    if (!password) return
    const { error } = await supabase.rpc('set_login_password', { p_user: p.id, p_password: password })
    alert(error ? error.message : `Password changed. Tell ${p.full_name} the new one.`)
  }

  async function setActive(p: Profile, active: boolean) {
    if (!active && !confirm(`Disable ${p.full_name}? They are signed out and cannot sign in until enabled again. Their records stay.`)) return
    const { error } = await supabase.rpc('set_login_active', { p_user: p.id, p_active: active })
    if (error) alert(error.message)
    load()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addPerson} className="card grid gap-3 sm:grid-cols-5 sm:items-end">
        <div><label>Name</label><input value={add.full_name} onChange={e => setAdd({ ...add, full_name: e.target.value })} required /></div>
        <div><label>Username</label><input autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9._\-]{3,30}" title="3-30 letters, numbers, dot, dash or underscore" value={add.username} onChange={e => setAdd({ ...add, username: e.target.value })} required /></div>
        <div><label>First password</label><input type="text" autoComplete="off" minLength={8} value={add.password} onChange={e => setAdd({ ...add, password: e.target.value })} required /></div>
        <div><label>Role</label>
          <select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value as Role })}>
            {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select>
        </div>
        <button className="btn">Add person</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                <td><input defaultValue={p.full_name} onBlur={e => e.target.value !== p.full_name && update(p.id, { full_name: e.target.value })} /></td>
                <td className="font-mono text-sm">{p.username}</td>
                <td className="w-44">
                  <select value={p.role} disabled={p.id === me} title={p.id === me ? 'You cannot change your own role' : ''} onChange={e => update(p.id, { role: e.target.value as Role })}>
                    {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </td>
                <td className="w-72 whitespace-nowrap text-right">
                  {p.active && <button type="button" className="btn-light" onClick={() => resetPassword(p)}>Reset password</button>}
                  {p.id !== me && <button type="button" className="btn-light ml-2" onClick={() => setActive(p, !p.active)}>{p.active ? 'Disable' : 'Enable'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
