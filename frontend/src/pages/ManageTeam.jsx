import { useState, useEffect } from 'react';
import { UserPlus, Edit2, Trash2, ChevronDown, ChevronRight, Shield, Users } from 'lucide-react';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import Modal from '../components/Modal';
import { PageSpinner } from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';
import { useAuth } from '../context/AuthContext';

const roleLabels = { super_admin: 'Super Admin', team_lead: 'Team Lead', field_worker: 'Field Worker' };

function UserForm({ initialData, parts, users, onSubmit, onClose, loading, creatorRole, creatorUser }) {
  const allowedRoles =
    creatorRole === 'super_admin' ? ['super_admin', 'team_lead', 'field_worker'] :
    creatorRole === 'team_lead'   ? ['field_worker'] : [];

  const defaultRole = allowedRoles[0] || 'field_worker';

  const [form, setForm] = useState({
    name:        initialData?.name        || '',
    phone:       initialData?.phone       || '',
    password:    '',
    role:        initialData?.role        || defaultRole,
    part_name:   initialData?.part_name   || '',
    part_number: initialData?.part_number || '',
    parent_id:   initialData?.parent_id   || '',
    is_active:   initialData?.is_active !== undefined ? initialData.is_active : 1,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // For team_lead: lock village to their own
  useEffect(() => {
    if (creatorRole === 'team_lead' && creatorUser?.part_name && !initialData) {
      set('part_name', creatorUser.part_name);
    }
  }, [creatorRole, creatorUser?.part_name]);

  const selectedVillage = parts.find(p => p.part_name === form.part_name);
  const partNumbers = selectedVillage?.part_numbers || [];

  const availableParts = creatorRole === 'team_lead'
    ? parts.filter(p => p.part_name === creatorUser?.part_name)
    : parts;

  // Auto-select part_number if only one exists for the village
  useEffect(() => {
    if (selectedVillage) {
      if (partNumbers.length === 1) {
        set('part_number', partNumbers[0]);
      }
    }
  }, [form.part_name]);

  const handleVillageChange = (value) => {
    set('part_name', value);
    set('part_number', '');
  };

  const villageReadOnly = creatorRole === 'team_lead';
  const showVillage = form.role === 'team_lead' || form.role === 'field_worker';
  const showPartNumber = form.role === 'field_worker';

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
          {allowedRoles.length <= 1 ? (
            <input className="input" value={roleLabels[form.role] || form.role} readOnly style={{ opacity: 0.7 }} />
          ) : (
            <select className="input" value={form.role} onChange={e => set('role', e.target.value)}>
              {allowedRoles.map(r => (
                <option key={r} value={r}>{roleLabels[r] || r}</option>
              ))}
            </select>
          )}
        </div>
        {showVillage && (
          <div>
            <label className="label">Assigned Village</label>
            {villageReadOnly ? (
              <input className="input" value={form.part_name || '—'} readOnly style={{ opacity: 0.7 }} />
            ) : (
              <select className="input" value={form.part_name} onChange={e => handleVillageChange(e.target.value)}>
                <option value="">— Select Village —</option>
                {availableParts.map(p => <option key={p.part_name} value={p.part_name}>{p.part_name} ({p.count} parts)</option>)}
              </select>
            )}
          </div>
        )}
        {showPartNumber && form.part_name && partNumbers.length > 1 && (
          <div>
            <label className="label">Part Number</label>
            <select className="input" value={form.part_number} onChange={e => set('part_number', e.target.value)}>
              <option value="">— Select Part —</option>
              {partNumbers.map(pn => <option key={pn} value={pn}>{pn}</option>)}
            </select>
          </div>
        )}
        {form.role === 'field_worker' && creatorRole === 'super_admin' && (
          <div className="col-span-2">
            <label className="label">Parent (Team Lead, optional)</label>
            <select className="input" value={form.parent_id} onChange={e => set('parent_id', e.target.value)}>
              <option value="">— None (top-level) —</option>
              {users.filter(u => u.role === 'team_lead' && u.id !== initialData?.id).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.part_name || 'No village'})</option>
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

function RowActions({ onEdit, onDelete }) {
  const btnCls = "p-1.5 rounded transition-all hover:bg-black hover:text-white";
  const style  = { color: 'var(--text-3)' };
  return (
    <div className="flex items-center gap-0.5">
      {onEdit   && <button onClick={onEdit}   title="Edit"   className={btnCls} style={style}><Edit2  size={13} /></button>}
      {onDelete && <button onClick={onDelete}  title="Delete" className={btnCls} style={style}><Trash2 size={13} /></button>}
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

function TeamLeadTree({ teamLead, fieldWorkers, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const children = fieldWorkers.filter(fw => fw.parent_id === teamLead.id);
  const hasChildren = children.length > 0;

  return (
    <>
      <tr>
        <td>
          <div className="flex items-center gap-2.5">
            {hasChildren
              ? <button onClick={() => setExpanded(!expanded)} className="opacity-40 hover:opacity-100 p-0.5 flex-shrink-0 transition-opacity">
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              : <div className="w-4 flex-shrink-0" />
            }
            <Avatar name={teamLead.name} />
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{teamLead.name}</div>
              <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{teamLead.phone}</div>
            </div>
          </div>
        </td>
        <td className="text-sm" style={{ color: 'var(--text-2)' }}>Team Lead</td>
        <td className="text-sm" style={{ color: 'var(--text-2)' }}>{teamLead.part_name || '—'}</td>
        <td className="text-sm" style={{ color: 'var(--text-3)' }}>—</td>
        <td style={{ minWidth: 140 }}>
          <MiniProgress done={teamLead.votes_done ?? 0} assigned={teamLead.assigned ?? 0} />
        </td>
        <td>
          <span className={teamLead.is_active ? 'badge-blue' : 'badge-slate'}>
            {teamLead.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <RowActions onEdit={() => onEdit(teamLead)} onDelete={() => onDelete(teamLead)} />
        </td>
      </tr>
      {expanded && children.map(fw => (
        <tr key={fw.id} className={!fw.is_active ? 'row-muted' : ''}>
          <td>
            <div className="flex items-center gap-2.5" style={{ paddingLeft: 36 }}>
              <Avatar name={fw.name} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{fw.name}</div>
                <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{fw.phone}</div>
              </div>
            </div>
          </td>
          <td className="text-sm" style={{ color: 'var(--text-2)' }}>Field Worker</td>
          <td className="text-sm" style={{ color: 'var(--text-2)' }}>{fw.part_name || '—'}</td>
          <td className="text-sm" style={{ color: 'var(--text-3)' }}>{fw.part_number || '—'}</td>
          <td style={{ minWidth: 140 }}>
            <MiniProgress done={fw.votes_done ?? 0} assigned={fw.assigned ?? 0} />
          </td>
          <td>
            <span className={fw.is_active ? 'badge-blue' : 'badge-slate'}>
              {fw.is_active ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <RowActions onEdit={() => onEdit(fw)} onDelete={() => onDelete(fw)} />
          </td>
        </tr>
      ))}
    </>
  );
}

export default function ManageTeam() {
  const { user } = useAuth();
  const [users, setUsers]           = useState([]);
  const [partsData, setPartsData]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const fetchData = async () => {
    const [u, p] = await Promise.all([api.get('/users'), api.get('/parts')]);
    setUsers(u.data.data); setPartsData(p.data.data); setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const myRole = user?.role;

  // Super Admin sees all users; Team Lead sees only their field workers
  const superAdmins = users.filter(u => u.role === 'super_admin');
  const teamLeads = users.filter(u => u.role === 'team_lead');
  const fieldWorkers = users.filter(u => u.role === 'field_worker');

  // For team_lead view: only their direct field workers
  const myFieldWorkers = fieldWorkers.filter(u => u.parent_id === user?.id);

  const openModal = (type, u = null) => { setModal(type); setSelected(u); setError(''); };

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
    add:  { title: myRole === 'team_lead' ? 'Add Field Worker' : 'Add User', onSubmit: f => withSave(() => {
      const payload = { ...f };
      if (myRole === 'team_lead') {
        payload.role = 'field_worker';
        payload.parent_id = user.id;
        payload.part_name = user.part_name;
      }
      return api.post('/users', payload);
    })},
    edit: { title: `Edit — ${selected?.name}`, onSubmit: f => withSave(() => api.put(`/users/${selected.id}`, f)) },
  };

  const pageTitle = myRole === 'super_admin' ? 'Manage Team' : 'My Field Workers';

  const subtitle = (() => {
    if (myRole === 'super_admin') {
      return `${superAdmins.length} super admins · ${teamLeads.length} team leads · ${fieldWorkers.length} field workers`;
    }
    if (myRole === 'team_lead') {
      return `${myFieldWorkers.length} field workers`;
    }
    return '';
  })();

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <button onClick={() => openModal('add')} className="btn-primary anim-up anim-d1">
          <UserPlus size={15} /> {myRole === 'team_lead' ? 'Add Field Worker' : 'Add User'}
        </button>
      </div>

      {/* ── Super Admin View ── */}
      {myRole === 'super_admin' && (
        <>
          {/* Section 1: Super Admins */}
          <div className="card overflow-hidden anim-up anim-d1">
            <div className="card-header">
              <Shield size={14} style={{ color: 'var(--text-2)' }} />
              <span className="card-header-title">Super Admins</span>
              <span className="badge-slate ml-auto">{superAdmins.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>Name</th><th>Role</th><th>Village</th><th>Part</th><th>Progress</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody className="anim-list">
                  {superAdmins.map(sa => (
                    <tr key={sa.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={sa.name} />
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{sa.name}</div>
                            <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{sa.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm" style={{ color: 'var(--text-2)' }}>Super Admin</td>
                      <td className="text-sm" style={{ color: 'var(--text-2)' }}>{sa.part_name || '—'}</td>
                      <td className="text-sm" style={{ color: 'var(--text-3)' }}>{sa.part_number || '—'}</td>
                      <td style={{ minWidth: 140 }}>
                        <MiniProgress done={sa.votes_done ?? 0} assigned={sa.assigned ?? 0} />
                      </td>
                      <td><span className={sa.is_active ? 'badge-blue' : 'badge-slate'}>{sa.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td><RowActions onEdit={() => openModal('edit', sa)} onDelete={() => handleDelete(sa)} /></td>
                    </tr>
                  ))}
                  {superAdmins.length === 0 && (
                    <tr><td colSpan="7" className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                      No super admins found.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Team Leads & Field Workers tree */}
          <div className="card overflow-hidden anim-up anim-d2">
            <div className="card-header">
              <Users size={14} style={{ color: 'var(--text-2)' }} />
              <span className="card-header-title">Team Leads & Field Workers</span>
              <span className="badge-slate ml-auto">{teamLeads.length + fieldWorkers.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th>Name</th><th>Role</th><th>Village</th><th>Part</th><th>Progress</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {teamLeads.map(tl => (
                    <TeamLeadTree
                      key={tl.id}
                      teamLead={tl}
                      fieldWorkers={fieldWorkers}
                      onEdit={u => openModal('edit', u)}
                      onDelete={handleDelete}
                    />
                  ))}
                  {/* Unattached field workers (no parent or parent is not a team lead) */}
                  {fieldWorkers.filter(fw => !fw.parent_id || !teamLeads.find(tl => tl.id === fw.parent_id)).map(fw => (
                    <tr key={fw.id} className={!fw.is_active ? 'row-muted' : ''}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-4 flex-shrink-0" />
                          <Avatar name={fw.name} />
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{fw.name}</div>
                            <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{fw.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-sm" style={{ color: 'var(--text-2)' }}>Field Worker</td>
                      <td className="text-sm" style={{ color: 'var(--text-2)' }}>{fw.part_name || '—'}</td>
                      <td className="text-sm" style={{ color: 'var(--text-3)' }}>{fw.part_number || '—'}</td>
                      <td style={{ minWidth: 140 }}>
                        <MiniProgress done={fw.votes_done ?? 0} assigned={fw.assigned ?? 0} />
                      </td>
                      <td>
                        <span className={fw.is_active ? 'badge-blue' : 'badge-slate'}>
                          {fw.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <RowActions onEdit={() => openModal('edit', fw)} onDelete={() => handleDelete(fw)} />
                      </td>
                    </tr>
                  ))}
                  {teamLeads.length === 0 && fieldWorkers.length === 0 && (
                    <tr><td colSpan="7" className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                      No team leads or field workers yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Team Lead View ── */}
      {myRole === 'team_lead' && (
        <div className="card overflow-hidden anim-up anim-d1">
          <div className="card-header">
            <Users size={14} style={{ color: 'var(--text-2)' }} />
            <span className="card-header-title">My Field Workers</span>
            <span className="badge-slate ml-auto">{myFieldWorkers.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr>
                <th>Name</th><th>Role</th><th>Village</th><th>Part</th><th>Progress</th><th>Status</th><th>Actions</th>
              </tr></thead>
              <tbody className="anim-list">
                {myFieldWorkers.map(fw => (
                  <tr key={fw.id} className={!fw.is_active ? 'row-muted' : ''}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={fw.name} />
                        <div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{fw.name}</div>
                          <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{fw.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-sm" style={{ color: 'var(--text-2)' }}>Field Worker</td>
                    <td className="text-sm" style={{ color: 'var(--text-2)' }}>{fw.part_name || '—'}</td>
                    <td className="text-sm" style={{ color: 'var(--text-3)' }}>{fw.part_number || '—'}</td>
                    <td style={{ minWidth: 140 }}>
                      <MiniProgress done={fw.votes_done ?? 0} assigned={fw.assigned ?? 0} />
                    </td>
                    <td>
                      <span className={fw.is_active ? 'badge-blue' : 'badge-slate'}>
                        {fw.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <RowActions onEdit={() => openModal('edit', fw)} onDelete={() => handleDelete(fw)} />
                    </td>
                  </tr>
                ))}
                {myFieldWorkers.length === 0 && (
                  <tr><td colSpan="7" className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>
                    No field workers yet. Add one to get started.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={modalProps[modal].title} onClose={() => setModal(null)}>
          <ErrorAlert message={error} />
          <UserForm
            initialData={modal === 'edit' ? selected : null}
            parts={partsData}
            users={users}
            onSubmit={modalProps[modal].onSubmit}
            onClose={() => setModal(null)}
            loading={saving}
            creatorRole={myRole}
            creatorUser={user}
          />
        </Modal>
      )}
    </div>
  );
}
