import { useState, useEffect, useMemo } from 'react';
import { Filter, MapPin, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import { TableSpinner } from '../components/Spinner';

const PAGE_SIZE = 30;

export default function ManageAreas() {
  const [parts, setParts]     = useState([]);   // flat rows from /parts/all
  const [loading, setLoading] = useState(true);

  // Filters
  const [query, setQuery]         = useState('');
  const [acNumber, setAcNumber]   = useState('');
  const [partName, setPartName]   = useState('');
  const [page, setPage]           = useState(1);

  useEffect(() => {
    let cancelled = false;
    api.get('/parts/all')
      .then(res => { if (!cancelled) { setParts(res.data.data || []); setLoading(false); } })
      .catch(err => { console.error(err); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Unique filter options
  const acNumbers = useMemo(() => {
    const s = new Set();
    parts.forEach(p => { if (p.ac_number != null) s.add(p.ac_number); });
    return [...s].sort((a, b) => a - b);
  }, [parts]);

  const partNames = useMemo(() => {
    const s = new Set();
    parts.forEach(p => { if (p.part_name) s.add(p.part_name); });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [parts]);

  // Apply filters
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter(p => {
      if (acNumber && String(p.ac_number) !== String(acNumber)) return false;
      if (partName && p.part_name !== partName)                 return false;
      if (q) {
        const hay = `${p.part_name ?? ''} ${p.part_number ?? ''} ${p.ac_number ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [parts, query, acNumber, partName]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [query, acNumber, partName]);

  const pages       = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows    = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Top stats — reflect the filtered view
  const totalVoters     = filtered.reduce((s, p) => s + (p.total_voters || 0), 0);
  const uniqueVillages  = new Set(filtered.map(p => p.part_name)).size;
  const uniqueAcs       = new Set(filtered.map(p => p.ac_number).filter(v => v != null)).size;

  const hasFilters = query || acNumber || partName;
  const clearAll   = () => { setQuery(''); setAcNumber(''); setPartName(''); };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Villages & Parts</h1>
          <p className="page-subtitle">{parts.length.toLocaleString()} total rows</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 anim-list">
        {[
          { label: 'Rows shown',   value: filtered.length.toLocaleString() },
          { label: 'Villages',     value: uniqueVillages.toLocaleString() },
          { label: 'AC Numbers',   value: uniqueAcs.toLocaleString() },
          { label: 'Voters',       value: totalVoters.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              {c.label}
            </div>
            <div className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card overflow-hidden anim-up anim-d1">
        <div className="card-header">
          <Filter size={13} style={{ color: 'var(--text-3)' }} />
          <span className="card-header-title" style={{ color: 'var(--text-3)', fontWeight: 600 }}>Filters</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Search */}
            <div className="relative">
              <Search size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--text-3)' }} />
              <input
                type="text"
                className="input text-sm pl-9"
                placeholder="Search village, part #, AC #…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>

            {/* Village dropdown */}
            <select className="input text-sm" value={partName} onChange={e => setPartName(e.target.value)}>
              <option value="">All Villages</option>
              {partNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {/* AC number dropdown */}
            <select className="input text-sm" value={acNumber} onChange={e => setAcNumber(e.target.value)}>
              <option value="">All AC Numbers</option>
              {acNumbers.map(ac => <option key={ac} value={ac}>AC {ac}</option>)}
            </select>
          </div>

          {hasFilters && (
            <button onClick={clearAll}
              className="text-xs mt-2 transition-opacity hover:opacity-60" style={{ color: 'var(--text-2)' }}>
              Clear all filters x
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden anim-up anim-d2">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Village</th>
                <th style={{ width: 120 }}>Part No.</th>
                <th className="hidden md:table-cell" style={{ width: 120 }}>AC No.</th>
                <th className="hidden lg:table-cell">State / District</th>
                <th style={{ width: 140 }}>Voters</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <TableSpinner cols={5} />
                : pageRows.map(p => (
                    <tr key={p.id || `${p.ac_number}-${p.part_number}`}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                            <MapPin size={13} style={{ color: 'var(--text-2)' }} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>
                              {p.part_name || '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge-slate font-mono">#{p.part_number}</span>
                      </td>
                      <td className="hidden md:table-cell">
                        {p.ac_number != null
                          ? <span className="voter-chip font-mono">AC {p.ac_number}</span>
                          : <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                      <td className="hidden lg:table-cell text-sm" style={{ color: 'var(--text-2)' }}>
                        {[p.state_cd, p.district_cd].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td>
                        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                          {(p.total_voters ?? 0).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan="5" className="py-12 text-center" style={{ color: 'var(--text-3)' }}>
                    <MapPin size={26} className="mx-auto mb-2 opacity-25" />
                    No villages/parts match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid var(--border)' }}>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>
              {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of{' '}
              {filtered.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="btn-secondary py-1.5 px-2.5">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                {currentPage} / {pages}
              </span>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={currentPage === pages}
                className="btn-secondary py-1.5 px-2.5">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
