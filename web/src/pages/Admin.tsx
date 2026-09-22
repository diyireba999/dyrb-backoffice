import { useEffect, useState } from 'react'
import { supabase, type Profile, type Role } from '../lib'

const ROLES: Role[] = ['owner', 'manager', 'accountant', 'staff']

// New people are added in Supabase > Authentication > Users > "Invite user".
// They show up here as Staff; owner changes their role.
export function Users() {
  const [list, setList] = useState<Profile[]>([])
  const load = () => { supabase.from('profiles').select('*').order('full_name').then(({ data }) => setList(data ?? [])) }
  useEffect(load, [])

  async function update(id: string, patch: Partial<Profile>) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    if (error) alert(error.message)
    load()
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Users</h2>
      <p className="text-sm text-stone-500">To add someone: Supabase dashboard → Authentication → Invite user. They appear here as Staff.</p>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Role</th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td><input defaultValue={p.full_name} onBlur={e => e.target.value !== p.full_name && update(p.id, { full_name: e.target.value })} /></td>
                <td className="w-44">
                  <select value={p.role} onChange={e => update(p.id, { role: e.target.value as Role })}>
                    {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
