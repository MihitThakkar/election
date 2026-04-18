import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import api from '../utils/api';
import { PageSpinner } from '../components/Spinner';

export default function ManageAreas() {
  const [villages, setVillages]     = useState([]);
  const [allParts, setAllParts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState({});

  useEffect(() => {
    const fetchData = async () => {
      const [grouped, flat] = await Promise.all([
        api.get('/parts'),
        api.get('/parts/all'),
      ]);
      setVillages(grouped.data.data);
      setAllParts(flat.data.data);
      setLoading(false);
    };
    fetchData();
  }, []);

  const toggleExpand = (name) => {
    setExpanded(e => ({ ...e, [name]: !e[name] }));
  };

  const getPartDetails = (partNumber) => {
    return allParts.find(p => p.part_number === partNumber);
  };

  const totalParts = villages.reduce((sum, v) => sum + v.count, 0);
  const totalVoters = allParts.reduce((sum, p) => sum + (p.total_voters || 0), 0);

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Villages & Parts</h1>
          <p className="page-subtitle">{villages.length} villages · {totalParts} parts</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 anim-list">
        {[
          { label: 'Total Villages', value: villages.length },
          { label: 'Total Parts',    value: totalParts },
          { label: 'Total Voters',   value: totalVoters.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>{c.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Villages list */}
      <div className="space-y-2 anim-list">
        {villages.map(village => (
          <div key={village.part_name} className="card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-4">
              <button onClick={() => toggleExpand(village.part_name)}
                className="transition-all hover:opacity-60 p-0.5 flex-shrink-0"
                style={{ color: 'var(--text-3)' }}>
                {expanded[village.part_name] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <MapPin size={15} style={{ color: 'var(--text-2)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>{village.part_name}</span>
                  <span className="badge-slate">{village.count} {village.count === 1 ? 'part' : 'parts'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {village.part_numbers.map(pn => (
                    <span key={pn} className="badge-slate text-xs" style={{ fontSize: '0.65rem', padding: '1px 6px' }}>
                      #{pn}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {expanded[village.part_name] && (
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                <div className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
                  Voter stats by part
                </div>
                <div className="space-y-1.5">
                  {village.part_numbers.map(pn => {
                    const detail = getPartDetails(pn);
                    return (
                      <div key={pn} className="flex items-center gap-3 text-sm rounded-lg px-3 py-2"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <span className="font-mono font-bold text-xs" style={{ color: 'var(--text-2)', minWidth: 40 }}>
                          #{pn}
                        </span>
                        <span className="flex-1 text-sm" style={{ color: 'var(--text)' }}>
                          {detail?.part_name || village.part_name}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                          {detail?.total_voters != null ? `${detail.total_voters.toLocaleString()} voters` : 'No data'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
        {villages.length === 0 && (
          <div className="card p-12 text-center anim-fade" style={{ color: 'var(--text-3)' }}>
            <MapPin size={32} className="mx-auto mb-3 opacity-20" />
            <p>No village/part data available.</p>
          </div>
        )}
      </div>
    </div>
  );
}
