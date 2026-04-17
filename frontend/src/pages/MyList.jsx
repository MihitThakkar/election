import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RotateCcw, MapPin, Home, RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { isEligible, STATUS_CONFIG, getApiError, formatDateTime } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from '../components/Spinner';

const TABS = ['All', 'Pending', 'Done', 'Refused'];

/** Reusable action button for voter status changes */
function ActionBtn({ onClick, disabled, title, children, dark }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-95 disabled:opacity-30"
      style={dark
        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
        : { background: 'var(--bg)', color: 'var(--text-2)', border: '1px solid var(--border)' }
      }>
      {children}
    </button>
  );
}

function VoterCard({ voter, onStatusChange, updating }) {
  const eligible = isEligible(voter.age);
  const cfg = STATUS_CONFIG[voter.status] ?? STATUS_CONFIG.pending;
  const isUpdating = updating === voter.id;

  return (
    <div className={`card card-hover overflow-hidden border-l-[3px] ${cfg.borderClass}`}>
      <div className="p-4 flex gap-3">
        {/* Main info */}
        <div className="flex-1 min-w-0">
          {/* Name + status */}
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="min-w-0">
              <h3 className="font-black text-base leading-tight truncate" style={{ color: 'var(--text)', letterSpacing: '-0.02em' }}>
                {voter.name}
              </h3>
              {voter.father_name && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                  S/D/W of {voter.father_name}
                </p>
              )}
            </div>
            <span className={`${cfg.badge} flex-shrink-0`}>{cfg.label}</span>
          </div>

          {/* Chips row */}
          <div className="flex flex-wrap gap-1.5">
            {voter.voter_id && <span className="voter-chip">{voter.voter_id}</span>}
            <span className="voter-chip">Age {voter.age || '?'}</span>
            {voter.gender && <span className="voter-chip">{voter.gender === 'M' ? 'Male' : 'Female'}</span>}
            {eligible && <span className="badge-blue">Eligible</span>}
          </div>

          {/* Address */}
          {voter.address && (
            <p className="text-xs mt-2 truncate flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <Home size={10} className="flex-shrink-0" />{voter.address}
            </p>
          )}

          {/* Marked-by footer */}
          {voter.status !== 'pending' && voter.marked_by_name && (
            <p className="text-xs mt-2 pt-2" style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
              Marked by <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{voter.marked_by_name}</span>
              {voter.marked_at && ` · ${formatDateTime(voter.marked_at)}`}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
          {voter.status !== 'done' && (
            <ActionBtn onClick={() => onStatusChange(voter.id, 'done')} disabled={isUpdating} title="Mark Done" dark>
              {isUpdating ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle size={17} />}
            </ActionBtn>
          )}
          {voter.status !== 'refused' && (
            <ActionBtn onClick={() => onStatusChange(voter.id, 'refused')} disabled={isUpdating} title="Mark Refused">
              <XCircle size={17} />
            </ActionBtn>
          )}
          {voter.status !== 'pending' && (
            <ActionBtn onClick={() => onStatusChange(voter.id, 'pending')} disabled={isUpdating} title="Reset">
              <RotateCcw size={14} />
            </ActionBtn>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyList() {
  const { user } = useAuth();
  const [voters, setVoters]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchVoters = useCallback(async () => {
    try {
      const res = await api.get('/voters', { params: { limit: 500 } });
      setVoters(res.data.data);
      setLastRefresh(new Date());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchVoters();
    const id = setInterval(fetchVoters, 30000);
    return () => clearInterval(id);
  }, [fetchVoters]);

  const handleStatusChange = async (voterId, status) => {
    setUpdating(voterId);
    try {
      const res = await api.put(`/voters/${voterId}/status`, { status });
      setVoters(prev => prev.map(v => v.id === voterId ? { ...v, ...res.data.data } : v));
    } catch (err) { alert(getApiError(err, 'Failed to update status')); }
    finally { setUpdating(null); }
  };

  const stats = {
    total:   voters.length,
    done:    voters.filter(v => v.status === 'done').length,
    refused: voters.filter(v => v.status === 'refused').length,
    pending: voters.filter(v => v.status === 'pending').length,
  };

  const filtered = activeTab === 'All' ? voters : voters.filter(v => v.status === activeTab.toLowerCase());
  const completionPct = stats.total ? Math.round(((stats.done + stats.refused) / stats.total) * 100) : 0;

  if (loading) return <PageSpinner message="Loading your voter list..." />;

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="flex items-start justify-between anim-up">
        <div>
          <h1 className="page-title">My Voter List</h1>
          {user?.area_name && (
            <p className="page-subtitle flex items-center gap-1">
              <MapPin size={12} /> {user.area_name}
            </p>
          )}
        </div>
        <button onClick={fetchVoters} className="btn-secondary text-sm py-1.5">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 anim-list">
        {[
          { label: 'Total',   value: stats.total },
          { label: 'Done',    value: stats.done },
          { label: 'Refused', value: stats.refused },
          { label: 'Pending', value: stats.pending },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className="text-xl font-bold" style={{ color: 'var(--text)' }}>{s.value}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="card p-4 anim-up anim-d2">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-semibold" style={{ color: 'var(--text-2)' }}>Progress</span>
          <span className="font-bold" style={{ color: 'var(--text)' }}>{completionPct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--bg)' }}>
          <div className="h-full progress-bar" style={{ width: `${stats.total?(stats.done/stats.total)*100:0}%`, background: '#0a0a0a' }} />
          <div className="h-full progress-bar" style={{ width: `${stats.total?(stats.refused/stats.total)*100:0}%`, background: '#888' }} />
        </div>
        <div className="flex justify-between mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
          <span>{stats.done} done · {stats.refused} refused</span>
          <span>{stats.pending} remaining</span>
        </div>
        {lastRefresh && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Auto-refreshes every 30s · {lastRefresh.toLocaleTimeString('en-IN', { timeStyle: 'short' })}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl anim-up anim-d2" style={{ background: 'var(--bg)' }}>
        {TABS.map(tab => {
          const count = tab === 'All' ? stats.total : stats[tab.toLowerCase()];
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all duration-200"
              style={{
                background: activeTab === tab ? 'var(--surface)' : 'transparent',
                color: activeTab === tab ? 'var(--text)' : 'var(--text-3)',
                boxShadow: activeTab === tab ? 'var(--shadow-sm)' : 'none',
              }}>
              {tab} {count > 0 && <span className="ml-1 text-xs opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-3 anim-list">
        {filtered.map(voter => (
          <VoterCard key={voter.id} voter={voter} onStatusChange={handleStatusChange} updating={updating} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-14 anim-fade" style={{ color: 'var(--text-3)' }}>
            <CheckCircle size={32} className="mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No {activeTab.toLowerCase()} voters</p>
            {activeTab === 'Pending' && <p className="text-sm mt-1">All voters have been visited.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
