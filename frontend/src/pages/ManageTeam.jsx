import { useState, useEffect } from 'react';
import { UserPlus, Edit2, Trash2, ChevronDown, ChevronRight, UserCheck, Shield } from 'lucide-react';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import Modal from '../components/Modal';
import { PageSpinner } from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

function UserForm({ initialData, areas, users, onSubmit, onClose, loading }) {
  const [form, setForm] = useState({
    name:      initialData?.name      || '',
    phone:     initialData?.phone     || '',
    password:  '',
    role:      initialData?.role      || 'field_worker',
    area_id:   initialData?.area_id   || '',
    parent_id: initialData?.parent_id || '',
    is_active: initialData?.is_active !== undefined ? initialData.is_active : 1,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Full Name *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Enter full name" />
        </div>
        <div>
          <label className="label">Phone *</label>
          <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} required placeholder="10-digit phone" maxLength={10} />
        </div>
        <div>
          <label className="label">{initialData ? 'New Password' : 'Password *'}</label>
          <input className="input" type="password" value={form.password} onChange={e => set('password', e.target.value)}
            required={!initialData} placeholder={initialData ? 'Leave blank to keep' : 'Set password'} />
        </div>
        <div>
          <label className="label">Role *</label>
          <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="field_worker">Field Worker</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
        <div>
          <label className="label">Assigned Area</label>
          <select className="input" value={form.area_id} onChange={e => set('area_id', e.target.value)}>
            <option value="">— Select Area —</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {form.role === 'field_worker' && (
          <div className="col-span-2">
            <label className="label">Parent Worker (optional)</label>
            <select className="input" value={form.parent_id} onChange={e => set('parent_id', e.target.value)}>
              <option value="">— None (top-level) —</option>
              {users.filter(u => u.role === 'field_worker' && u.id !== initialData?.id).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.area_name || 'No area'})</option>
              ))}
            </select>
          </div>
        )}
        {initialData && (
          <div className="col-span-2 flex items-center gap-3">
            <label className="label mb-0">Status</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active === 1}
                onChange={e => set('is_active', e.target.checked ? 1 : 0)}
                className="w-4 h-4 accent-black" />
              <span className="text-sm" style={{ color: 'var(--text-2)' }}>Active</span>
            </label>
          </div>
        )}
      </div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? 'Saving...' : (initialData ? 'Save Changes' : 'Create User')}
        </button>
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </form>
  );
}

function Avatar({ name }) {
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{ background: 'var(--bg)', color: 'var(--text)', border: '1.5px solid var(--border)' }}>
      {name?.[0]?.toUpperCase()}
    </div>
  );
}

function RowActions({ onEdit, onDelete, onAddSub }) {
  const btnCls = "p-1.5 rounded transition-all hover:bg-black hover:text-white";
  const style  = { color: 'var(--text-3)' };
  return (
    <div className="flex items-center gap-0.5">
      {onEdit    && <button onClick={onEdit}    title="Edit"           className={btnCls} style={style}><Edit2   size={13} /></button>}
      {onAddSub  && <button onClick={onAddSub}  title="Add sub-worker" className={btnCls} style={style}><UserPlus size={13} /></button>}
      {onDelete  && <button onClick={onDelete}  title="Delete"         className={btnCls} style={style}><Trash2   size={13} /></button>}
    </div>
  );
}

function MiniProgress({ done = 0, assigned = 0 }) {
  const pct = assigned > 0 ? Math.min(100, Math.round((done / assigned) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-semibold" style={{ color: 'var(--text)' }}>{done} done</span>
        <span style={{ color: 'var(--text-3)' }}>{assigned} total</span>
      </div>
      <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
        <div className="h-full rounded-full progress-bar" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function WorkerRow({ worker, areas, allWorkers, onEdit, onDelete, onAddSub, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = worker.children?.length > 0;
  return (
    <>
      <tr className={!worker.is_active ? 'row-muted' : ''}>
        <td>
          <div className="flex items-center gap-2.5" style={{ paddingLeft: depth * 18 }}>
            {hasChildren
              ? <button onClick={() => setExpanded(!expanded)} className="opacity-40 hover:opacity-100 p-0.5 flex-shrink-0 transition-opacity">
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              : <div className="w-4 flex-shrink-0" />
            }
            <Avatar name={worker.name} />
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{worker.name}</div>
              <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{worker.phone}</div>
            </div>
          </div>
        </td>
        <td className="text-sm" style={{ color: 'var(--text-2)' }}>{worker.area_name || '—'}</td>
        <td className="text-sm" style={{ color: 'var(--text-3)' }}>{worker.parent_name || '—'}</td>
        <td style={{ minWidth: 140 }}>
          <MiniProgress done={worker.votes_done ?? 0} assigned={worker.assigned ?? 0} />
        </td>
        <td>
          <span className={worker.is_active ? 'badge-blue' : 'badge-slate'}>
            {worker.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <RowActions onEdit={() => onEdit(worker)} onDelete={() => onDelete(worker)} onAddSub={() => onAddSub(worker)} />
        </td>
      </tr>
      {expanded && hasChildren && worker.children.map(c => (
        <WorkerRow key={c.id} worker={c} areas={areas} allWorkers={allWorkers}
          onEdit={onEdit} onDelete={onDelete} onAddSub={onAddSub} depth={depth + 1} />
      ))}
    </>
  );
}

export default function ManageTeam() {
  const [users, setUsers]       = useState([]);
  const [areas, setAreas]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const fetchData = async () => {
    const [u, a] = await Promise.all([api.get('/users'), api.get('/areas')]);
    setUsers(u.data.data); setAreas(a.data.data); setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const buildTree = (workers, parentId = null) =>
    workers
      .filter(w => (parentId === null ? !w.parent_id : w.parent_id === parentId))
      .map(w => ({ ...w, children: buildTree(workers, w.id) }));

  const admins = users.filter(u => u.role === 'super_admin');
  const fieldWorkers = users.filter(u => u.role === 'field_worker');
  const workerTree = buildTree(fieldWorkers);

  const openModal = (type, user = null) => { setModal(type); setSelected(user); setError(''); };

  const withSave = async (fn) => {
    setSaving(true); setError('');
    try { await fn(); await fetchData(); setModal(null); }
    catch (err) { setError(getApiError(err)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`Delete ${u.name}?`)) return;
    try { await api.delete(`/users/${u.id}`); await fetchData(); }
    catch (err) { alert(getApiError(err, 'Delete failed')); }
  };

  const modalProps = {
    add:    { title: 'Add New User',                      onSubmit: f => withSave(() => api.post('/users', f)) },
    edit:   { title: `Edit — ${selected?.name}`,           onSubmit: f => withSave(() => api.put(`/users/${selected.id}`, f)) },
    addSub: { title: `Sub-worker under ${selected?.name}`, onSubmit: f => withSave(() => api.post(`/users/${selected.id}/add-sub-worker`, f)) },
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Manage Team</h1>
          <p className="page-subtitle">{admins.length} admins · {fieldWorkers.length} field workers</p>
        </div>
        <button onClick={() => openModal('add')} className="btn-primary anim-up anim-d1">
          <UserPlus size={15} /> Add User
        </button>
      </div>

      {/* Admins */}
      <div className="card overflow-hidden anim-up anim-d1">
        <div className="card-header">
          <Shield size={14} style={{ color: 'var(--text-2)' }} />
          <span className="card-header-title">Super Admins</span>
          <span className="badge-slate ml-auto">{admins.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th>Name</th><th>Phone</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody className="anim-list">
              {admins.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={a.name} />
                      <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{a.name}</span>
                    </div>
                  </td>
                  <td className="text-sm font-mono" style={{ color: 'var(--text-2)' }}>{a.phone}</td>
                  <td><span className={a.is_active ? 'badge-blue' : 'badge-slate'}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td><RowActions onEdit={() => openModal('edit', a)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field Workers */}
      <div className="card overflow-hidden anim-up anim-d2">
        <div className="card-header">
          <UserCheck size={14} style={{ color: 'var(--text-2)' }} />
          <span className="card-header-title">Field Workers</span>
          <span className="badge-slate ml-auto">{fieldWorkers.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th>Name</th><th>Area</th><th>Reports To</th><th>Progress</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {workerTree.map(w => (
                <WorkerRow key={w.id} worker={w} areas={areas} allWorkers={fieldWorkers}
                  onEdit={u => openModal('edit', u)}
                  onDelete={handleDelete}
                  onAddSub={u => openModal('addSub', u)} />
              ))}
              {workerTree.length === 0 && (
                <tr><td colSpan="6" className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                  No field workers yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal title={modalProps[modal].title} onClose={() => setModal(null)}>
          <ErrorAlert message={error} />
          <UserForm initialData={modal === 'edit' ? selected : null} areas={areas} users={users}
            onSubmit={modalProps[modal].onSubmit} onClose={() => setModal(null)} loading={saving} />
        </Modal>
      )}
    </div>
  );
}
