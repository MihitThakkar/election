import { useState, useCallback, useRef } from 'react';
import { Search, MapPin, User, Hash, Phone, Home } from 'lucide-react';
import api from '../utils/api';
import { isEligible, STATUS_CONFIG, formatDateTime } from '../utils/helpers';

export default function GlobalSearch() {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await api.get('/voters/search', { params: { q } });
      setResults(res.data.data); setSearched(true);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  const handleChange = (e) => {
    const v = e.target.value; setQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 350);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="anim-up">
        <h1 className="page-title">Global Search</h1>
        <p className="page-subtitle">Search for any voter across all areas</p>
      </div>

      {/* Search input */}
      <div className="relative anim-up anim-d1">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-3)' }} />
        <input autoFocus type="text" value={query} onChange={handleChange}
          placeholder="Search by voter name, EPIC ID, or phone..."
          className="input pl-11 py-3.5 text-base" />
        {loading && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--border)' }} />
        )}
      </div>

      {/* Results */}
      {searched && (
        <div className="anim-up">
          <p className="text-sm mb-3" style={{ color: 'var(--text-3)' }}>
            {results.length > 0 ? `${results.length} result${results.length > 1 ? 's' : ''} found` : 'No results found'}
          </p>

          <div className="space-y-3 anim-list">
            {results.map(v => {
              const eligible = isEligible(v.age);
              const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.pending;
              return (
                <div key={v.id} className={`card card-hover p-4 border-l-4 ${cfg.borderClass}`}>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <h3 className="font-bold text-base" style={{ color: 'var(--text)' }}>{v.name}</h3>
                    <span className={cfg.badge}>{cfg.label}</span>
                    {eligible && <span className="badge-blue">Eligible</span>}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm" style={{ color: 'var(--text-3)' }}>
                    {[
                      v.voter_id  && { icon: Hash,  text: <span className="font-mono font-semibold" style={{ color: 'var(--text-2)' }}>{v.voter_id}</span> },
                      true        && { icon: User,  text: `Age ${v.age||'?'} · ${v.gender==='M'?'Male':v.gender==='F'?'Female':'—'}` },
                      v.father_name && { icon: User, text: `S/D/W of ${v.father_name}` },
                      v.phone     && { icon: Phone, text: v.phone },
                      v.area_name && { icon: MapPin,text: v.area_name },
                    ].filter(Boolean).map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <item.icon size={12} className="flex-shrink-0" />
                        <span>{item.text}</span>
                      </div>
                    ))}
                    {v.address && (
                      <div className="flex items-center gap-1.5 col-span-2">
                        <Home size={12} className="flex-shrink-0" /><span className="truncate">{v.address}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3 mt-3 pt-3 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}>
                    <span>
                      Assigned: <span className={`font-semibold ${v.assigned_worker_name ? '' : ''}`}
                        style={{ color: 'var(--text-2)' }}>
                        {v.assigned_worker_name || 'Unassigned'}
                      </span>
                    </span>
                    {v.marked_by_name && (
                      <span>
                        Marked by: <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{v.marked_by_name}</span>
                        {v.marked_at && <span> · {formatDateTime(v.marked_at)}</span>}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {results.length === 0 && (
              <div className="text-center py-12 anim-fade" style={{ color: 'var(--text-3)' }}>
                <Search size={30} className="mx-auto mb-3 opacity-20" />
                <p className="font-semibold">No voters found</p>
                <p className="text-sm mt-1">Try a different name or voter ID</p>
              </div>
            )}
          </div>
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-14 anim-fade" style={{ color: 'var(--text-3)' }}>
          <Search size={40} className="mx-auto mb-3 opacity-10" />
          <p className="font-medium" style={{ color: 'var(--text-2)' }}>Start typing to search</p>
          <p className="text-sm mt-1">Search by name, EPIC ID, phone, or father's name</p>
        </div>
      )}
    </div>
  );
}
