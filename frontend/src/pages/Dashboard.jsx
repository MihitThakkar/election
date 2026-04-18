import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import api from '../utils/api';
import { timeAgo } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from '../components/Spinner';

/* Done=indigo, Refused=red-400, Pending=slate-200 */
const MONO = ['#4F46E5', '#F87171', '#E2E8F0'];

/** KPI card — large number as hero, optional thin progress bar at bottom */
function StatCard({ label, value, sub, delay = 0, pct }) {
  return (
    <div className="card card-hover p-5 anim-up relative overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-number">{value?.toLocaleString() ?? '—'}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
      {pct !== undefined && (
        <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
          <div className="h-full rounded-full progress-bar" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
      )}
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    background: '#FFFFFF', border: '1px solid #E2E8F0',
    borderRadius: 8, boxShadow: '0 4px 12px rgba(15,23,42,.10)',
    fontSize: 12, color: '#0F172A',
  },
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats]           = useState(null);
  const [areaStats, setAreaStats]   = useState([]);
  const [workerStats, setWorkerStats] = useState([]);
  const [todayData, setTodayData]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, a, w, t] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/area-stats'),
        api.get('/dashboard/worker-stats'),
        api.get('/dashboard/today'),
      ]);
      setStats(s.data.data);
      setAreaStats(a.data.data);
      setWorkerStats(w.data.data);
      setTodayData(t.data.data);
      setLastUpdated(new Date());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  if (loading) return <PageSpinner />;

  const pieData = stats ? [
    { name: 'Done',    value: stats.done },
    { name: 'Refused', value: stats.refused },
    { name: 'Pending', value: stats.pending },
  ] : [];

  const barData = areaStats.filter(a => a.total_voters > 0).slice(0, 8).map(a => ({
    name:    (a.part_name || a.name || '').substring(0, 12),
    Done:    parseInt(a.done) || 0,
    Refused: parseInt(a.refused) || 0,
    Pending: parseInt(a.pending) || 0,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Campaign Dashboard</h1>
          <p className="page-subtitle">
            Welcome, {user?.name}{lastUpdated ? ` · Updated ${timeAgo(lastUpdated)}` : ''}
          </p>
        </div>
        <button onClick={fetchAll} className="btn-secondary text-sm anim-up anim-d1">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
        <StatCard label="Total Voters"   value={stats?.total_voters}    delay={0} />
        <StatCard label="Eligible 18–35" value={stats?.eligible_voters} delay={50}
          sub={`${stats?.total_voters ? Math.round(stats.eligible_voters/stats.total_voters*100) : 0}% of total`}
          pct={stats?.total_voters ? Math.round(stats.eligible_voters/stats.total_voters*100) : 0} />
        <StatCard label="Votes Done"     value={stats?.done}            delay={100}
          sub={`${stats?.completion_pct || 0}% complete`}
          pct={stats?.completion_pct || 0} />
        <StatCard label="Refused"        value={stats?.refused}         delay={150} />
        <StatCard label="Pending"        value={stats?.pending}         delay={200} />
        <StatCard label="Areas"          value={stats?.areas}           delay={250} />
        <StatCard label="Field Workers"  value={stats?.workers}         delay={300} />
        <StatCard label="Unassigned"     value={stats?.unassigned}      delay={350}
          sub="Without a worker" />
      </div>

      {/* Today + overall progress strip */}
      {todayData && (
        <div className="grid grid-cols-3 gap-3 lg:gap-4">
          <div className="card p-5 anim-up" style={{ borderTop: '3px solid #10B981', animationDelay: '0ms' }}>
            <p className="kpi-label">Today Done</p>
            <p className="kpi-number" style={{ color: '#059669' }}>{todayData.today_done || 0}</p>
          </div>
          <div className="card p-5 anim-up" style={{ borderTop: '3px solid #EF4444', animationDelay: '60ms' }}>
            <p className="kpi-label">Today Refused</p>
            <p className="kpi-number" style={{ color: '#DC2626' }}>{todayData.today_refused || 0}</p>
          </div>
          <div className="card p-5 anim-up" style={{ borderTop: '3px solid var(--accent)', animationDelay: '120ms' }}>
            <p className="kpi-label">Campaign Progress</p>
            <p className="kpi-number">{stats?.completion_pct || 0}<span className="text-2xl font-bold">%</span></p>
            <div className="mt-3 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
              <div className="h-full rounded-full progress-bar" style={{ width: `${stats?.completion_pct||0}%`, background: 'var(--accent)' }} />
            </div>
            <p className="kpi-sub">{(stats?.done ?? 0) + (stats?.refused ?? 0)} of {stats?.total_voters} covered</p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2 anim-up anim-d2">
          <h3 className="font-bold mb-4" style={{ color: 'var(--text)' }}>Area-wise Progress</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Done"    fill={MONO[0]} radius={[3,3,0,0]} maxBarSize={28} />
              <Bar dataKey="Refused" fill={MONO[1]} radius={[3,3,0,0]} maxBarSize={28} />
              <Bar dataKey="Pending" fill={MONO[2]} radius={[3,3,0,0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5 anim-up anim-d3">
          <h3 className="font-bold mb-4" style={{ color: 'var(--text)' }}>Status Distribution</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={65} innerRadius={30} dataKey="value" stroke="none">
                {pieData.map((_, i) => <Cell key={i} fill={MONO[i]} />)}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={v => v.toLocaleString()} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {pieData.map((item, i) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: MONO[i] }} />
                  <span style={{ color: 'var(--text-2)' }}>{item.name}</span>
                </div>
                <span className="font-bold" style={{ color: 'var(--text)' }}>{item.value?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Workers + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 anim-up anim-d2">
          <h3 className="font-bold mb-4" style={{ color: 'var(--text)' }}>Top Workers</h3>
          <div className="space-y-2.5 anim-list">
            {workerStats.slice(0, 8).map((w, i) => (
              <div key={w.id} className="flex items-center gap-3">
                <span className="text-xs font-bold w-5 text-center tabular-nums"
                  style={{ color: i < 3 ? 'var(--text)' : 'var(--text-3)' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{w.name}</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>{w.votes_done}</span>
                  </div>
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {w.part_name || w.area_name || 'No village'}{w.part_number ? ` · Part ${w.part_number}` : ''}
                  </div>
                </div>
              </div>
            ))}
            {workerStats.length === 0 && <p className="text-sm" style={{ color: 'var(--text-3)' }}>No data yet</p>}
          </div>
        </div>

        <div className="card p-5 anim-up anim-d3">
          <h3 className="font-bold mb-4" style={{ color: 'var(--text)' }}>Activity Feed</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto anim-list">
            {todayData?.activityFeed?.map(log => (
              <div key={log.id} className="flex items-start gap-2 text-sm">
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: 'var(--text-3)' }} />
                <div className="flex-1 min-w-0">
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>{log.user_name}</span>
                  <span style={{ color: 'var(--text-3)' }}> · </span>
                  <span style={{ color: 'var(--text-2)' }}>{log.details}</span>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{timeAgo(log.created_at)}</div>
                </div>
              </div>
            ))}
            {(!todayData?.activityFeed?.length) && (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>No activity yet today</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
