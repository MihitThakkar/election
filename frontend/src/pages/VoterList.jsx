import { useState, useEffect, useCallback } from 'react';
import { Filter, UserCheck, ChevronLeft, ChevronRight, Users, X, Shield, User } from 'lucide-react';
import api from '../utils/api';
import { STATUS_CONFIG, isEligible } from '../utils/helpers';
import { TableSpinner } from '../components/Spinner';

const roleLabels = { super_admin: 'Super Admin', team_lead: 'Team Lead', field_worker: 'Field Worker' };

function AssignPanel({ count, teamMembers, onAssign, onClose }) {
  const [assignTo, setAssignTo] = useState(null);
  const [saving, setSaving]     = useState(false);

  const teamLeads   = teamMembers.filter(m => m.role === 'team_lead');
  const fieldWorkers = teamMembers.filter(m => m.role === 'field_worker');

  const handleAssign = async () => {
    if (!assignTo) return;
    setSaving(true);
    try { await onAssign(assignTo); } finally { setSaving(false); }
  };

  const MemberCard = ({ member, isSelected }) => (
    <button
      onClick={() => setAssignTo(member.id)}
      className="w-full text-left px-4 py-3 rounded-xl transition-all duration-150"
      style={{
        background: isSelected ? 'var(--accent)' : 'var(--bg)',
        color: isSelected ? '#fff' : 'var(--text)',
        border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
        transform: isSelected ? 'scale(1.02)' : 'scale(1)',
        boxShadow: isSelected ? '0 4px 14px rgba(79,70,229,.25)' : 'none',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{
            background: isSelected ? 'rgba(255,255,255,.2)' : 'var(--border)',
            color: isSelected ? '#fff' : 'var(--text)',
          }}>
          {member.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{member.name}</div>
          <div className="text-xs mt-0.5 truncate" style={{ opacity: isSelected ? 0.8 : 0.55 }}>
            {member.part_name || 'No village'}{member.part_number ? ` · Part ${member.part_number}` : ''}
          </div>
        </div>
        <div className="flex-shrink-0">
          {member.role === 'team_lead'
            ? <Shield size={14} style={{ opacity: isSelected ? 0.9 : 0.35 }} />
            : <User size={14} style={{ opacity: isSelected ? 0.9 : 0.35 }} />
          }
        </div>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)', animation: 'fadeIn .2s ease' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        style={{
          background: 'var(--surface)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-lg)',
          animation: 'scaleIn .22s ease',
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>
              Assign {count} Voter{count > 1 ? 's' : ''}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Select a team member below
            </p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:bg-black hover:text-white"
            style={{ color: 'var(--text-3)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Member List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {teamLeads.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[.12em] mb-2 flex items-center gap-1.5"
                style={{ color: 'var(--text-3)' }}>
                <Shield size={11} /> Team Leads
              </div>
              <div className="space-y-2">
                {teamLeads.map(m => <MemberCard key={m.id} member={m} isSelected={assignTo === m.id} />)}
              </div>
            </div>
          )}

          {fieldWorkers.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[.12em] mb-2 flex items-center gap-1.5"
                style={{ color: 'var(--text-3)' }}>
                <User size={11} /> Field Workers
              </div>
              <div className="space-y-2">
                {fieldWorkers.map(m => <MemberCard key={m.id} member={m} isSelected={assignTo === m.id} />)}
              </div>
            </div>
          )}

          {teamLeads.length === 0 && fieldWorkers.length === 0 && (
            <div className="py-8 text-center" style={{ color: 'var(--text-3)' }}>
              <Users size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No team members found.</p>
              <p className="text-xs mt-1">Create team leads or field workers first.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={handleAssign} disabled={!assignTo || saving}
            className="btn-primary flex-1 justify-center py-2.5">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Assigning...</>
              : <><UserCheck size={15} /> Assign{assignTo ? '' : ' — select a member'}</>}
          </button>
          <button onClick={onClose} className="btn-secondary px-5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function VoterList() {
  const [voters, setVoters]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  const [filters, setFilters] = useState({ status: '', assigned_to: '', eligible: false });
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
    // Fetch team members and parts separately to avoid one failure blocking both
    api.get('/users').then(u => {
      const members = (u.data.data || []).filter(m => ['team_lead', 'field_worker'].includes(m.role));
      setTeamMembers(members);
    }).catch(err => console.error('Failed to load users:', err));

    api.get('/parts').then(p => {
      setPartsData(p.data.data || []);
    }).catch(err => console.error('Failed to load parts:', err));
  }, []);

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll    = () => setSelected(voters.filter(v => !v.assigned_to).map(v => v.id));

  const handleBulkAssign = async (voterIds, workerId) => {
    await api.post('/voters/assign', { voter_ids: voterIds, worker_id: parseInt(workerId) });
    setSelected([]); setShowAssign(false); fetchVoters();
  };

  const hasFilters = filters.status || filters.assigned_to || filters.eligible || partName;

  const clearAllFilters = () => {
    setFilters({ status: '', assigned_to: '', eligible: false });
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
          <select className="input text-sm" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([val, cfg]) => <option key={val} value={val}>{cfg.label}</option>)}
          </select>
          <select className="input text-sm" value={filters.assigned_to} onChange={e => setFilter('assigned_to', e.target.value)}>
            <option value="">All Team Members</option>
            {teamMembers.map(w => <option key={w.id} value={w.id}>{w.name} ({roleLabels[w.role]})</option>)}
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
                <th className="hidden lg:table-cell">Village</th>
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
                        <td className="hidden lg:table-cell text-sm" style={{ color: 'var(--text-2)' }}>
                          {v.part_number ? <span className="badge-slate">Part {v.part_number}</span> : (v.area_name || '—')}
                        </td>
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

      {/* Assign Panel */}
      {showAssign && <AssignPanel
        count={selected.length}
        teamMembers={teamMembers}
        onAssign={async (workerId) => { await handleBulkAssign(selected, workerId); }}
        onClose={() => setShowAssign(false)}
      />}
    </div>
  );
}
