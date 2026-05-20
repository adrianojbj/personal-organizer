import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function People() {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ name: '', slack_user_id: '', email: '' });
  const [editingId, setEditingId] = useState(null);

  const load = () => api.people.list().then(setPeople);
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editingId) {
      await api.people.update(editingId, form);
    } else {
      await api.people.create(form);
    }
    setForm({ name: '', slack_user_id: '', email: '' });
    setEditingId(null);
    load();
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setForm({ name: p.name, slack_user_id: p.slack_user_id || '', email: p.email || '' });
  };

  const remove = async (id) => {
    if (!confirm('Delete this person? Their tasks will be unassigned.')) return;
    await api.people.remove(id);
    load();
  };

  const ping = async (id) => {
    const r = await api.people.ping(id);
    alert(r.ok ? 'DM sent ✅' : 'Failed — check Slack ID and bot config');
  };

  return (
    <div>
      <h1>People</h1>
      <form className="card" onSubmit={submit}>
        <div className="form-row">
          <input placeholder="Name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Slack User ID (U…)" value={form.slack_user_id}
            onChange={(e) => setForm({ ...form, slack_user_id: e.target.value })} />
          <input placeholder="Email (optional)" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="row-actions">
          <button type="submit">{editingId ? 'Save' : 'Add person'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={() => {
              setEditingId(null);
              setForm({ name: '', slack_user_id: '', email: '' });
            }}>Cancel</button>
          )}
        </div>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Tip: Get Slack User ID in Slack → click profile → ⋯ → Copy member ID.
        </p>
      </form>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Slack ID</th><th>Email</th><th></th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.slack_user_id || '—'}</td>
                <td className="muted">{p.email || '—'}</td>
                <td className="row-actions">
                  <button className="secondary" onClick={() => startEdit(p)}>Edit</button>
                  <button className="secondary" onClick={() => ping(p.id)} disabled={!p.slack_user_id}>Ping</button>
                  <button className="danger" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {people.length === 0 && (
              <tr><td colSpan="4" className="muted">No people yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
