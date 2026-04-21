import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Filter, UserCheck, ChevronLeft, ChevronRight, Users, X, Shield, User, CheckCircle, XCircle, RotateCcw, ArrowLeft, Sparkles } from 'lucide-react';
import api from '../utils/api';
import { STATUS_CONFIG, isEligible, getApiError } from '../utils/helpers';
import { TableSpinner } from '../components/Spinner';
import { useAuth } from '../context/AuthContext';

const roleLabels = { super_admin: 'Super Admin', team_lead: 'Team Lead', field_worker: 'Field Worker' };

/** Tap-to-approve / reject icon group (reused per table row). */
function StatusActions({ voter, updating, onChange }) {
  const btn = (status, Icon, title, dark) => (
    <button
      key={status}
      onClick={() => onChange(status)}
      disabled={updating || voter.status === status}
      title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
      style={dark
        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
        : { background: 'var(--bg)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
    >
      {updating ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
               : <Icon size={14} />}
    </button>
  );
  return (
    <div className="flex gap-1.5">
      {btn('done',    CheckCircle, 'Approve', true)}
      {btn('refused', XCircle,     'Reject',  false)}
      {btn('pending', RotateCcw,   'Reset to Pending', false)}
    </div>
  );
}

/**
 * Hierarchical assign modal.
 * - super_admin: step 1 picks a Team Lead, step 2 optionally picks a Field Worker under that TL.
 *   If no FW chosen, voters are assigned to the Team Lead directly.
 * - team_lead: only shows their own Field Workers (no TL step).
 *
 * Rendered through a React portal to `document.body` so that the page-enter
 * `transform` animation can't create a containing block that pins the modal
 * below the fold.
 */
function AssignPanel({ count, teamMembers, currentUser, onAssign, onClose }) {
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const teamLeads = useMemo(
    () => teamMembers.filter(m => m.role === 'team_lead'),
    [teamMembers]
  );

  // For team_lead role: start already "in" the team-lead scope (themselves)
  const [step, setStep]           = useState(isSuperAdmin ? 'tl' : 'fw');
  const [selectedTL, setSelectedTL] = useState(isSuperAdmin ? null : currentUser);
  const [selectedFW, setSelectedFW] = useState(null);
  const [saving, setSaving]       = useState(false);

  // Field workers whose parent is the selected team lead
  const workersForTL = useMemo(() => {
    if (!selectedTL) return [];
    return teamMembers.filter(
      m => m.role === 'field_worker' && m.parent_id === selectedTL.id
    );
  }, [teamMembers, selectedTL]);

  const assignee      = selectedFW ?? selectedTL;
  const assigneeRole  = selectedFW ? 'Field Worker' : (isSuperAdmin ? 'Team Lead' : null);

  const handlePickTL = (tl) => {
    setSelectedTL(tl);
    setSelectedFW(null);
    setStep('fw');
  };

  const handleBack = () => {
    setStep('tl');
    setSelectedFW(null);
    // keep selectedTL so the user sees which one they were in
  };

  const handleAssign = async () => {
    if (!assignee) return;
    setSaving(true);
    try { await onAssign(assignee.id); } finally { setSaving(false); }
  };

  const MemberRow = ({ member, isSelected, onClick, icon: Icon, accent }) => (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 rounded-xl transition-all duration-150 flex items-center gap-3"
      style={{
        background: isSelected ? 'var(--accent)' : 'var(--surface)',
        color: isSelected ? '#fff' : 'var(--text)',
        border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
        boxShadow: isSelected ? '0 6px 18px rgba(79,70,229,.28)' : 'none',
      }}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{
          background: isSelected ? 'rgba(255,255,255,.18)' : accent ?? 'var(--bg)',
          color: isSelected ? '#fff' : 'var(--text)',
        }}
      >
        {member.name?.[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{member.name}</div>
        <div className="text-xs mt-0.5 truncate" style={{ opacity: isSelected ? 0.85 : 0.55 }}>
          {member.part_name || 'No village'}
          {member.part_number ? ` · Part ${member.part_number}` : ''}
        </div>
      </div>
      <Icon size={15} style={{ opacity: isSelected ? 0.95 : 0.4, flexShrink: 0 }} />
    </button>
  );

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
        background: 'rgba(15,23,42,.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'fadeIn .18s ease',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md flex flex-col overflow-hidden"
        style={{
          background: 'var(--surface)',
          borderRadius: '18px',
          boxShadow: '0 24px 60px rgba(15,23,42,.28), 0 2px 6px rgba(15,23,42,.12)',
          animation: 'scaleIn .22s ease',
          maxHeight: 'min(85vh, 680px)',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[.18em] mb-1"
                style={{ color: 'var(--text-3)' }}>
                Assignment
              </div>
              <h2 className="text-lg font-black leading-tight tracking-tight"
                style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}>
                {count} Voter{count > 1 ? 's' : ''} to assign
              </h2>
            </div>
            <button onClick={onClose} title="Close"
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:bg-black hover:text-white flex-shrink-0"
              style={{ color: 'var(--text-3)' }}>
              <X size={16} />
            </button>
          </div>

          {/* Breadcrumb / step indicator */}
          {isSuperAdmin && (
            <div className="flex items-center gap-2 mt-4 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold"
                style={{
                  background: step === 'tl' ? 'var(--accent)' : 'var(--bg)',
                  color: step === 'tl' ? '#fff' : 'var(--text-2)',
                  border: step === 'tl' ? 'none' : '1px solid var(--border)',
                }}>
                <Shield size={11} /> Team Lead
                {selectedTL && step !== 'tl' && <span className="opacity-80 ml-1">· {selectedTL.name}</span>}
              </span>
              <span style={{ color: 'var(--text-3)' }}>→</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold"
                style={{
                  background: step === 'fw' ? 'var(--accent)' : 'var(--bg)',
                  color: step === 'fw' ? '#fff' : 'var(--text-3)',
                  border: step === 'fw' ? 'none' : '1px solid var(--border)',
                  opacity: selectedTL ? 1 : 0.5,
                }}>
                <User size={11} /> Field Worker
              </span>
            </div>
          )}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* STEP 1 — choose Team Lead (super_admin only) */}
          {step === 'tl' && (
            <div className="space-y-2 anim-fade">
              <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                Pick a team lead. You'll then choose one of their field workers — or assign directly to the team lead.
              </p>
              {teamLeads.length === 0 ? (
                <div className="py-10 text-center" style={{ color: 'var(--text-3)' }}>
                  <Shield size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold">No team leads found.</p>
                  <p className="text-xs mt-1">Create a team lead first.</p>
                </div>
              ) : (
                teamLeads.map(tl => (
                  <MemberRow
                    key={tl.id}
                    member={tl}
                    icon={Shield}
                    accent="#EEF2FF"
                    isSelected={selectedTL?.id === tl.id}
                    onClick={() => handlePickTL(tl)}
                  />
                ))
              )}
            </div>
          )}

          {/* STEP 2 — choose Field Worker (or skip to assign to TL) */}
          {step === 'fw' && selectedTL && (
            <div className="space-y-2 anim-fade">
              {isSuperAdmin && (
                <button
                  onClick={handleBack}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold mb-3 transition-opacity hover:opacity-60"
                  style={{ color: 'var(--text-2)' }}
                >
                  <ArrowLeft size={13} /> Change team lead
                </button>
              )}

              <div className="rounded-xl p-3 mb-3 flex items-center gap-3"
                style={{ background: 'linear-gradient(135deg,#EEF2FF 0%,#F5F3FF 100%)', border: '1px solid #C7D2FE' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
                  {selectedTL.name?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: '#4338CA' }}>
                    Team Lead
                  </div>
                  <div className="font-bold text-sm truncate" style={{ color: '#1E1B4B' }}>{selectedTL.name}</div>
                </div>
              </div>

              <p className="text-xs mb-2" style={{ color: 'var(--text-3)' }}>
                Pick a field worker under this team lead — or leave unselected to assign to the team lead.
              </p>

              {workersForTL.length === 0 ? (
                <div className="py-8 text-center rounded-xl" style={{ color: 'var(--text-3)', background: 'var(--bg)' }}>
                  <User size={24} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-semibold">No field workers under this team lead.</p>
                  <p className="text-xs mt-1">Clicking Assign will give all voters to the team lead.</p>
                </div>
              ) : (
                workersForTL.map(fw => (
                  <MemberRow
                    key={fw.id}
                    member={fw}
                    icon={User}
                    accent="#F1F5F9"
                    isSelected={selectedFW?.id === fw.id}
                    onClick={() => setSelectedFW(prev => prev?.id === fw.id ? null : fw)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          {assignee && step === 'fw' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-2)' }}>
                <Sparkles size={12} style={{ color: 'var(--accent)' }} />
                <span>
                  Assigning <span className="font-bold" style={{ color: 'var(--text)' }}>{count}</span> voter{count > 1 ? 's' : ''} to{' '}
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{assignee.name}</span>
                  <span className="opacity-70"> · {assigneeRole}</span>
                </span>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAssign} disabled={saving}
                  className="btn-primary flex-1 justify-center py-2.5">
                  {saving
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Assigning…</>
                    : <><UserCheck size={15} /> Confirm assignment</>}
                </button>
                <button onClick={onClose} className="btn-secondary px-5">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button disabled className="btn-primary flex-1 justify-center py-2.5 opacity-40 cursor-not-allowed">
                <UserCheck size={15} />
                {step === 'tl' ? 'Select a team lead' : 'Select a field worker'}
              </button>
              <button onClick={onClose} className="btn-secondary px-5">Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function VoterList() {
  const { user: currentUser } = useAuth();
  const [voters, setVoters]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);
  // Default: eligible (age 18-35) filter is ON
  const [filters, setFilters] = useState({ status: '', assigned_to: '', eligible: true });
  const [updating, setUpdating] = useState(null);
  const [page, setPage]       = useState(1);
  const [selected, setSelected] = useState([]);
  const [showAssign, setShowAssign] = useState(false);

  // Part / category filter state
  const [partsData, setPartsData]     = useState([]);
  const [partName, setPartName]       = useState('');
  const [partNumber, setPartNumber]   = useState('');
  // Sub-section filter
  const [subSections, setSubSections] = useState([]);
  const [subSection, setSubSection]   = useState('');

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); setSelected([]); };

  // Derived: part_numbers for the currently selected partName
  const selectedPartEntry = partsData.find(p => p.part_name === partName);
  const partNumbers = selectedPartEntry ? selectedPartEntry.part_numbers : [];
  const showPartNumberDropdown = partNumbers.length > 1;

  const handlePartNameChange = (value) => {
    setPartName(value);
    setPartNumber('');
    setSubSection('');
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
    setSubSection('');
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
    if (subSection)         params.sub_section = subSection;
    const res = await api.get('/voters', { params });
    setVoters(res.data.data); setTotal(res.data.total); setPages(res.data.pages);
    setLoading(false);
  }, [filters, page, partName, partNumber, subSection]);

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

  // Load sub-sections only once a part (number or name) is chosen.
  useEffect(() => {
    if (!partNumber && !partName) { setSubSections([]); setSubSection(''); return; }
    const params = {};
    if (partNumber) params.part_number = partNumber;
    else if (partName) params.part_name = partName;
    api.get('/voters/sub-sections', { params })
      .then(r => setSubSections(r.data.data || []))
      .catch(err => { console.error('Failed to load sub-sections:', err); setSubSections([]); });
  }, [partNumber, partName]);

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll    = () => setSelected(voters.filter(v => !v.assigned_to).map(v => v.id));

  const handleBulkAssign = async (voterIds, workerId) => {
    await api.post('/voters/assign', { voter_ids: voterIds, worker_id: parseInt(workerId) });
    setSelected([]); setShowAssign(false); fetchVoters();
  };

  const handleStatusChange = async (voterId, status) => {
    setUpdating(voterId);
    try {
      const res = await api.put(`/voters/${voterId}/status`, { status });
      setVoters(prev => prev.map(v => v.id === voterId ? { ...v, ...res.data.data } : v));
    } catch (err) {
      alert(getApiError(err, 'Failed to update status'));
    } finally {
      setUpdating(null);
    }
  };

  const hasFilters = filters.status || filters.assigned_to || filters.eligible || partName || subSection;

  const clearAllFilters = () => {
    setFilters({ status: '', assigned_to: '', eligible: false });
    setPartName('');
    setPartNumber('');
    setSubSection('');
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
          {(partNumber || partName) && subSections.length > 0 && (
            <select className="input text-sm" value={subSection}
              onChange={e => { setSubSection(e.target.value); setPage(1); setSelected([]); }}
              title="Filter by sub-section">
              <option value="">All Sub-sections</option>
              {subSections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
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
                <th style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <TableSpinner cols={8} />
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
                        <td>
                          <StatusActions voter={v} updating={updating === v.id}
                            onChange={(status) => handleStatusChange(v.id, status)} />
                        </td>
                      </tr>
                    );
                  })
              }
              {!loading && voters.length === 0 && (
                <tr><td colSpan="8" className="py-12 text-center" style={{ color: 'var(--text-3)' }}>
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
        currentUser={currentUser}
        onAssign={async (workerId) => { await handleBulkAssign(selected, workerId); }}
        onClose={() => setShowAssign(false)}
      />}
    </div>
  );
}
