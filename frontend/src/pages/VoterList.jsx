import { useState, useEffect, useCallback } from 'react';
import { Filter, UserCheck, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import api from '../utils/api';
import { STATUS_CONFIG, isEligible } from '../utils/helpers';
import Modal from '../components/Modal';
import { TableSpinner } from '../components/Spinner';

function AssignModal({ voterIds, workers, onAssign, onClose }) {
  const [workerId, setWorkerId] = useState('');
  const [saving, setSaving]     = useState(false);
  const handleAssign = async () => {
    if (!workerId) return;
    setSaving(true); await onAssign(voterIds, workerId); setSaving(false);
  };
  return (
    <Modal title={`Assign ${voterIds.length} Voter${voterIds.length > 1 ? 's' : ''}`} onClose={onClose}>
      <select className="input mb-4" value={workerId} onChange={e => setWorkerId(e.target.value)}>
        <option value="">— Select a worker —</option>
        {workers.map(w => <option key={w.id} value={w.id}>{w.name} ({w.area_name || 'No area'})</option>)}
      </select>
      <div className="flex gap-3">
        <button onClick={handleAssign} disabled={!workerId || saving} className="btn-primary flex-1 justify-center">
          {saving ? 'Assigning...' : 'Assign'}
        </button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </Modal>
  );
}

export default function VoterList() {
  const [voters, setVoters]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas]     = useState([]);
  const [workers, setWorkers] = useState([]);
  const [filters, setFilters] = useState({ area_id: '', status: '', assigned_to: '', eligible: false });
  const [page, setPage]       = useState(1);
  const [selected, setSelected] = useState([]);
  const [showAssign, setShowAssign] = useState(false);

  // Part / category filter state
  const [partsData, setPartsData]     = useState([]);
  const [partName, setPartName]       = useState('');
  const [partNumber, setPartNumber]   = useState('');

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); setSelected([]); };

  // Derived: part_numbers for the currently selected partName
  const selectedPartEntry = partsData.find(p => p.part_name === partName);
  const partNumbers = selectedPartEntry ? selectedPartEntry.part_numbers : [];
  const showPartNumberDropdown = partNumbers.length > 1;

  const handlePartNameChange = (value) => {
    setPartName(value);
    setPartNumber('');
    setPage(1);
    setSelected([]);

    // If only 1 part_number for this part_name, auto-select it
    if (value) {
      const entry = partsData.find(p => p.part_name === value);
      if (entry && entry.part_numbers.length === 1) {
        setPartNumber(String(entry.part_numbers[0]));
      }
    }
  };

  const handlePartNumberChange = (value) => {
    setPartNumber(value);
    setPage(1);
    setSelected([]);
  };

  const fetchVoters = useCallback(async () => {
    setLoading(true);
    const params = { page, limit: 30 };
    if (filters.area_id)    params.area_id     = filters.area_id;
    if (filters.status)     params.status      = filters.status;
    if (filters.assigned_to) params.assigned_to = filters.assigned_to;
    if (filters.eligible)   params.eligible    = true;
    if (partName)           params.part_name   = partName;
    if (partNumber)         params.part_number = partNumber;
    const res = await api.get('/voters', { params });
    setVoters(res.data.data); setTotal(res.data.total); setPages(res.data.pages);
    setLoading(false);
  }, [filters, page, partName, partNumber]);

  useEffect(() => { fetchVoters(); }, [fetchVoters]);
  useEffect(() => {
    Promise.all([
      api.get('/areas'),
      api.get('/users?role=field_worker'),
      api.get('/parts'),
    ]).then(([a, u, p]) => {
      setAreas(a.data.data);
      setWorkers(u.data.data);
      setPartsData(p.data.data || []);
    });
  }, []);

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll    = () => setSelected(voters.filter(v => !v.assigned_to).map(v => v.id));

  const handleBulkAssign = async (voterIds, workerId) => {
    await api.post('/voters/assign', { voter_ids: voterIds, worker_id: parseInt(workerId) });
    setSelected([]); setShowAssign(false); fetchVoters();
  };

  const hasFilters = filters.area_id || filters.status || filters.assigned_to || filters.eligible || partName;

  const clearAllFilters = () => {
    setFilters({ area_id: '', status: '', assigned_to: '', eligible: false });
    setPartName('');
    setPartNumber('');
    setPage(1);
    setSelected([]);
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Voter List</h1>
          <p className="page-subtitle">{total.toLocaleString()} voters</p>
        </div>
        {selected.length > 0 && (
          <button onClick={() => setShowAssign(true)} className="btn-primary anim-scale">
            <UserCheck size={16} /> Assign {selected.length} Selected
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card overflow-hidden anim-up anim-d1">
        <div className="card-header">
          <Filter size={13} style={{ color: 'var(--text-3)' }} />
          <span className="card-header-title" style={{ color: 'var(--text-3)', fontWeight: 600 }}>Filters</span>
        </div>
        <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Part / Village dropdown */}
          <select className="input text-sm" value={partName} onChange={e => handlePartNameChange(e.target.value)}>
            <option value="">All Parts / Villages</option>
            {partsData.map(p => (
              <option key={p.part_name} value={p.part_name}>
                {p.part_name} ({p.count})
              </option>
            ))}
          </select>
          {/* Part Number dropdown - only when selected part has multiple numbers */}
          {showPartNumberDropdown && (
            <select className="input text-sm" value={partNumber} onChange={e => handlePartNumberChange(e.target.value)}>
              <option value="">All Part Numbers</option>
              {partNumbers.map(num => (
                <option key={num} value={String(num)}>{num}</option>
              ))}
            </select>
          )}
          <select className="input text-sm" value={filters.area_id} onChange={e => setFilter('area_id', e.target.value)}>
            <option value="">All Areas</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="input text-sm" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([val, cfg]) => <option key={val} value={val}>{cfg.label}</option>)}
          </select>
          <select className="input text-sm" value={filters.assigned_to} onChange={e => setFilter('assigned_to', e.target.value)}>
            <option value="">All Workers</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg border transition-all hover:border-black"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <input type="checkbox" checked={filters.eligible}
              onChange={e => setFilter('eligible', e.target.checked)} className="w-4 h-4 accent-black" />
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>Eligible only (18-35)</span>
          </label>
        </div>
          {hasFilters && (
            <button onClick={clearAllFilters}
              className="text-xs mt-2 transition-opacity hover:opacity-60" style={{ color: 'var(--text-2)' }}>
              Clear all filters x
            </button>
          )}
        </div>
      </div>

      {/* Bulk-select */}
      {voters.some(v => !v.assigned_to) && (
        <div className="flex items-center gap-3 text-sm anim-up anim-d1">
          <button onClick={selectAll} className="underline transition-opacity hover:opacity-60" style={{ color: 'var(--text-2)' }}>
            Select unassigned
          </button>
          {selected.length > 0 && (
            <>
              <button onClick={() => setSelected([])} className="underline transition-opacity hover:opacity-60"
                style={{ color: 'var(--text-3)' }}>Clear</button>
              <span style={{ color: 'var(--text-2)' }}>{selected.length} selected</span>
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden anim-up anim-d2">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" className="w-4 h-4 accent-black"
                    onChange={e => e.target.checked ? selectAll() : setSelected([])}
                    checked={selected.length > 0 && selected.length === voters.filter(v=>!v.assigned_to).length} />
                </th>
                <th>Voter</th>
                <th>Age / Gender</th>
                <th className="hidden md:table-cell">Voter ID</th>
                <th className="hidden lg:table-cell">Area</th>
                <th className="hidden lg:table-cell">Assigned To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <TableSpinner cols={7} />
                : voters.map(v => {
                    const el  = isEligible(v.age);
                    const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.pending;
                    const sel = selected.includes(v.id);
                    return (
                      <tr key={v.id} style={sel ? { background: '#f5f5f5' } : {}}>
                        <td>
                          <input type="checkbox" checked={sel} onChange={() => toggleSelect(v.id)}
                            className="w-4 h-4 accent-black" />
                        </td>
                        <td>
                          <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{v.name}</div>
                          {v.father_name && <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>S/D/W of {v.father_name}</div>}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <span className="voter-chip">{v.age || '—'}{v.gender ? ` · ${v.gender}` : ''}</span>
                            {el && <span className="badge-blue">Eligible</span>}
                          </div>
                        </td>
                        <td className="hidden md:table-cell">
                          <span className="voter-chip">{v.voter_id || '—'}</span>
                        </td>
                        <td className="hidden lg:table-cell text-sm" style={{ color: 'var(--text-2)' }}>{v.area_name || '—'}</td>
                        <td className="hidden lg:table-cell">
                          {v.assigned_worker_name
                            ? <span className="text-sm" style={{ color: 'var(--text-2)' }}>{v.assigned_worker_name}</span>
                            : <span className="badge-amber">Unassigned</span>}
                        </td>
                        <td>
                          <span className={cfg.badge}>{cfg.label}</span>
                          {v.marked_by_name && <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>by {v.marked_by_name}</div>}
                        </td>
                      </tr>
                    );
                  })
              }
              {!loading && voters.length === 0 && (
                <tr><td colSpan="7" className="py-12 text-center" style={{ color: 'var(--text-3)' }}>
                  <Users size={26} className="mx-auto mb-2 opacity-25" />
                  No voters found matching your filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>
              {((page-1)*30)+1}–{Math.min(page*30, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1} className="btn-secondary py-1.5 px-2.5">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{page} / {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages, p+1))} disabled={page===pages} className="btn-secondary py-1.5 px-2.5">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showAssign && (
        <AssignModal voterIds={selected} workers={workers} onAssign={handleBulkAssign} onClose={() => setShowAssign(false)} />
      )}
    </div>
  );
}
