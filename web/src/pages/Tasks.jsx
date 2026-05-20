import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUSES = ['pending', 'ack', 'in_progress', 'done', 'blocked'];
const STATUS_LABEL = {
  pending: 'Pending',
  ack: 'Acknowledged',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
};

export default function Tasks({ mineOnly = false }) {
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [filter, setFilter] = useState({ assignee_id: '', status: '' });
  const [form, setForm] = useState(blankForm());
  const [editingId, setEditingId] = useState(null);
  const [events, setEvents] = useState({ open: null, items: [] });

  function blankForm() {
    return {
      title: '',
      description: '',
      assignee_id: '',
      due_date: '',
      is_owner_task: mineOnly,
    };
  }

  const load = () => {
    const params = {};
    if (mineOnly) params.mine = '1';
    if (filter.assignee_id) params.assignee_id = filter.assignee_id;
    if (filter.status) params.status = filter.status;
    return api.tasks.list(params).then(setTasks);
  };

  useEffect(() => { api.people.list().then(setPeople); }, []);
  useEffect(() => { load(); /* eslint-disable-line */ }, [mineOnly, filter.assignee_id, filter.status]);
  useEffect(() => { setForm(blankForm()); setEditingId(null); /* eslint-disable-line */ }, [mineOnly]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const payload = {
      ...form,
      assignee_id: form.is_owner_task ? null : (form.assignee_id || null),
      due_date: form.due_date || null,
    };
    if (editingId) await api.tasks.update(editingId, payload);
    else await api.tasks.create(payload);
    setForm(blankForm());
    setEditingId(null);
    load();
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      title: t.title,
      description: t.description || '',
      assignee_id: t.assignee_id || '',
      due_date: t.due_date || '',
      is_owner_task: !!t.is_owner_task,
    });
  };

  const changeStatus = async (t, status) => {
    await api.tasks.update(t.id, { status });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this task?')) return;
    await api.tasks.remove(id);
    load();
  };

  const notify = async (id) => {
    const r = await api.tasks.notify(id);
    alert(r.ok ? 'Notification sent ✅' : 'Failed to send — check Slack config / assignee Slack ID');
  };

  const openEvents = async (id) => {
    if (events.open === id) { setEvents({ open: null, items: [] }); return; }
    const items = await api.tasks.events(id);
    setEvents({ open: id, items });
  };

  return (
    <div>
      <h1>{mineOnly ? 'My Tasks' : 'Tasks'}</h1>

      <form className="card" onSubmit={submit}>
        <div className="form-row">
          <input placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <input type="date" value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <select
            value={form.is_owner_task ? '__me' : (form.assignee_id || '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__me') setForm({ ...form, is_owner_task: true, assignee_id: '' });
              else setForm({ ...form, is_owner_task: false, assignee_id: v });
            }}
          >
            <option value="">— Unassigned —</option>
            <option value="__me">👤 Me (owner)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <textarea placeholder="Description (optional)" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="row-actions" style={{ marginTop: '0.5rem' }}>
          <button type="submit">{editingId ? 'Save' : 'Create task'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(blankForm()); }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {!mineOnly && (
        <div className="filters">
          <select value={filter.assignee_id}
            onChange={(e) => setFilter({ ...filter, assignee_id: e.target.value })}>
            <option value="">All assignees</option>
            {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <select value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
          </select>
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Title</th><th>Assignee</th><th>Due</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td className="muted">{t.id}</td>
                  <td>
                    <strong>{t.title}</strong>
                    {t.description && <div className="muted">{t.description}</div>}
                  </td>
                  <td>{t.is_owner_task ? '👤 Me' : (t.assignee_name || <span className="muted">—</span>)}</td>
                  <td>{t.due_date || <span className="muted">—</span>}</td>
                  <td>
                    <select className={`status ${t.status}`} value={t.status}
                      onChange={(e) => changeStatus(t, e.target.value)}>
                      {STATUSES.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
                    </select>
                  </td>
                  <td className="row-actions">
                    <button className="secondary" onClick={() => startEdit(t)}>Edit</button>
                    <button className="secondary" onClick={() => notify(t.id)}>Notify</button>
                    <button className="secondary" onClick={() => openEvents(t.id)}>
                      {events.open === t.id ? 'Hide log' : 'Log'}
                    </button>
                    <button className="danger" onClick={() => remove(t.id)}>Delete</button>
                  </td>
                </tr>
                {events.open === t.id && (
                  <tr>
                    <td colSpan="6" style={{ background: '#11141a' }}>
                      {events.items.length === 0 && <span className="muted">No events yet.</span>}
                      {events.items.map((ev) => (
                        <div key={ev.id} className="muted" style={{ fontSize: '0.8rem' }}>
                          [{ev.created_at}] <strong>{ev.type}</strong>
                          {ev.payload ? ` — ${ev.payload}` : ''}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {tasks.length === 0 && (
              <tr><td colSpan="6" className="muted">No tasks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
