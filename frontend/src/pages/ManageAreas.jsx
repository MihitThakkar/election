import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import api from '../utils/api';
import { getApiError } from '../utils/helpers';
import Modal from '../components/Modal';
import { PageSpinner } from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

export default function ManageAreas() {
  const [areas, setAreas]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState({});
  const [areaDetails, setAreaDetails] = useState({});
  const [modal, setModal]         = useState(false);
  const [selected, setSelected]   = useState(null);
  const [form, setForm]           = useState({ name: '', district: '' });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const fetchAreas = async () => {
    const res = await api.get('/areas');
    setAreas(res.data.data); setLoading(false);
  };
  useEffect(() => { fetchAreas(); }, []);

  const toggleExpand = async (id) => {
    if (expanded[id]) { setExpanded(e => ({ ...e, [id]: false })); return; }
    setExpanded(e => ({ ...e, [id]: true }));
    if (!areaDetails[id]) {
      const res = await api.get(`/areas/${id}`);
      setAreaDetails(d => ({ ...d, [id]: res.data.data }));
    }
  };

  const openAdd  = () => { setSelected(null); setForm({ name: '', district: '' }); setModal(true); setError(''); };
  const openEdit = (a) => { setSelected(a); setForm({ name: a.name, district: a.district || '' }); setModal(true); setError(''); };

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (selected) await api.put(`/areas/${selected.id}`, form);
      else await api.post('/areas', form);
      await fetchAreas(); setAreaDetails({}); setModal(false);
    } catch (err) { setError(getApiError(err)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (a) => {
    if (!confirm(`Delete "${a.name}"?`)) return;
    try { await api.delete(`/areas/${a.id}`); await fetchAreas(); }
    catch (err) { alert(getApiError(err, 'Delete failed')); }
  };

  const pct = (a) => a.total_voters ? Math.round(((a.done + a.refused) / a.total_voters) * 100) : 0;
  const totals = areas.reduce((acc, a) => ({
    voters:  acc.voters  + (a.total_voters || 0),
    done:    acc.done    + (a.done    || 0),
    pending: acc.pending + (a.pending || 0),
  }), { voters: 0, done: 0, pending: 0 });

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Manage Areas</h1>
          <p className="page-subtitle">{areas.length} wards/towns configured</p>
        </div>
        <button onClick={openAdd} className="btn-primary anim-up anim-d1">
          <Plus size={15} /> Add Area
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 anim-list">
        {[
          { label: 'Total Areas',  value: areas.length },
          { label: 'Total Voters', value: totals.voters.toLocaleString() },
          { label: 'Done',         value: totals.done.toLocaleString() },
          { label: 'Pending',      value: totals.pending.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{c.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Areas */}
      <div className="space-y-2 anim-list">
        {areas.map(area => (
          <div key={area.id} className="card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-4">
              <button onClick={() => toggleExpand(area.id)}
                className="transition-all hover:opacity-60 p-0.5 flex-shrink-0"
                style={{ color: 'var(--text-3)' }}>
                {expanded[area.id] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <MapPin size={15} style={{ color: 'var(--text-2)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>{area.name}</span>
                  {area.district && <span className="badge-slate">{area.district}</span>}
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex-1 max-w-36 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                    <div className="h-full rounded-full progress-bar" style={{ width: `${pct(area)}%`, background: '#0a0a0a' }} />
                  </div>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>
                    {area.done || 0} / {area.total_voters || 0} · <strong style={{ color: 'var(--text-2)' }}>{pct(area)}%</strong>
                  </span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-4 text-sm font-semibold mr-2">
                <span style={{ color: 'var(--text-3)' }}>{area.worker_count||0} workers</span>
                <span style={{ color: 'var(--text)' }}>{area.done||0} ✓</span>
                <span style={{ color: 'var(--text-3)' }}>{area.refused||0} ✗</span>
                <span style={{ color: 'var(--text-3)' }}>{area.pending||0} ⏳</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => openEdit(area)}
                  className="p-1.5 rounded transition-all hover:bg-black hover:text-white"
                  style={{ color: 'var(--text-3)' }}><Edit2 size={13} /></button>
                <button onClick={() => handleDelete(area)}
                  className="p-1.5 rounded transition-all hover:bg-black hover:text-white"
                  style={{ color: 'var(--text-3)' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {expanded[area.id] && (
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                {areaDetails[area.id] ? (
                  areaDetails[area.id].workers.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
                        Workers in this area
                      </div>
                      {areaDetails[area.id].workers.map(w => (
                        <div key={w.id} className="flex items-center gap-3 text-sm rounded-lg px-3 py-2"
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: 'var(--bg)', color: 'var(--text)' }}>
                            {w.name[0]}
                          </div>
                          <span className="font-medium" style={{ color: 'var(--text)' }}>{w.name}</span>
                          {w.parent_id && <span className="badge-slate text-xs">sub</span>}
                          <div className="ml-auto flex gap-3 text-xs font-semibold">
                            <span style={{ color: 'var(--text)' }}>{w.done||0} ✓</span>
                            <span style={{ color: 'var(--text-3)' }}>{w.refused||0} ✗</span>
                            <span style={{ color: 'var(--text-3)' }}>{w.assigned||0} assigned</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm" style={{ color: 'var(--text-3)' }}>No workers assigned yet.</p>
                ) : (
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
                    <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: 'var(--border)' }} />
                    Loading...
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {areas.length === 0 && (
          <div className="card p-12 text-center anim-fade" style={{ color: 'var(--text-3)' }}>
            <MapPin size={32} className="mx-auto mb-3 opacity-20" />
            <p>No areas configured yet.</p>
          </div>
        )}
      </div>

      {modal && (
        <Modal title={selected ? `Edit — ${selected.name}` : 'Add New Area'} onClose={() => setModal(false)}>
          <ErrorAlert message={error} />
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Area/Ward Name *</label>
              <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required placeholder="e.g. Ward 12 - Model Town" />
            </div>
            <div>
              <label className="label">District</label>
              <input className="input" value={form.district} onChange={e => setForm(f => ({ ...f, district: e.target.value }))}
                placeholder="e.g. Dehradun" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? 'Saving...' : (selected ? 'Save Changes' : 'Create Area')}
              </button>
              <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
