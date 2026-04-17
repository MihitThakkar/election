import { useState, useEffect } from 'react';
import { Bell, Send, CheckCheck, MapPin } from 'lucide-react';
import api from '../utils/api';
import { timeAgo, getApiError } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { PageSpinner } from '../components/Spinner';
import ErrorAlert from '../components/ErrorAlert';

export default function Notifications() {
  const { user, setUnreadCount } = useAuth();
  const isAdmin = user?.role === 'super_admin';

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [areas, setAreas]       = useState([]);
  const [showCompose, setShowCompose] = useState(false);
  const [form, setForm]         = useState({ title: '', message: '', target_area_id: '' });
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');

  const fetchNotifs = async () => {
    const res = await api.get('/notifications');
    setNotifications(res.data.data); setLoading(false);
  };
  useEffect(() => {
    fetchNotifs();
    if (isAdmin) api.get('/areas').then(r => setAreas(r.data.data));
  }, [isAdmin]);

  const markRead = async (id) => {
    await api.put(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };
  const markAllRead = async () => {
    await api.put('/notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
  };
  const handleSend = async (e) => {
    e.preventDefault(); setSending(true); setError('');
    try {
      await api.post('/notifications', { title: form.title, message: form.message, target_area_id: form.target_area_id || null });
      setForm({ title: '', message: '', target_area_id: '' }); setShowCompose(false); await fetchNotifs();
    } catch (err) { setError(getApiError(err)); }
    finally { setSending(false); }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="page-header">
        <div className="anim-up">
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">{isAdmin ? `${notifications.length} sent` : `${unreadCount} unread`}</p>
        </div>
        <div className="flex gap-2 anim-up anim-d1">
          {!isAdmin && unreadCount > 0 && (
            <button onClick={markAllRead} className="btn-secondary text-sm">
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowCompose(!showCompose)} className="btn-primary">
              <Send size={14} /> Send Notification
            </button>
          )}
        </div>
      </div>

      {/* Compose */}
      {showCompose && isAdmin && (
        <div className="card p-5 anim-scale" style={{ border: '1.5px solid var(--border-strong)' }}>
          <h3 className="font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Send size={15} /> Compose Notification
          </h3>
          <ErrorAlert message={error} />
          <form onSubmit={handleSend} className="space-y-3">
            <div>
              <label className="label">Title *</label>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                required placeholder="e.g. Meeting at 6 PM" />
            </div>
            <div>
              <label className="label">Message *</label>
              <textarea className="input resize-none" rows={3} value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                required placeholder="Type your message here..." />
            </div>
            <div>
              <label className="label">Target</label>
              <select className="input" value={form.target_area_id}
                onChange={e => setForm(f => ({ ...f, target_area_id: e.target.value }))}>
                <option value="">All Field Workers</option>
                {areas.map(a => <option key={a.id} value={a.id}>Workers in {a.name} only</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={sending} className="btn-primary flex-1 justify-center">
                {sending ? 'Sending...' : <><Send size={13} /> Send Now</>}
              </button>
              <button type="button" onClick={() => { setShowCompose(false); setError(''); }} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      <div className="space-y-2 anim-list">
        {notifications.length === 0 ? (
          <div className="text-center py-14 anim-fade" style={{ color: 'var(--text-3)' }}>
            <Bell size={32} className="mx-auto mb-3 opacity-20" />
            <p className="font-semibold">No notifications yet</p>
          </div>
        ) : notifications.map(n => {
          const unread = !n.is_read && !isAdmin;
          return (
            <div key={n.id}
              onClick={() => unread && markRead(n.id)}
              className={`card p-4 transition-all duration-200 ${unread ? 'cursor-pointer card-hover' : ''}`}
              style={unread ? { borderColor: '#111' } : {}}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'var(--bg)' }}>
                  <Bell size={15} style={{ color: unread ? 'var(--text)' : 'var(--text-3)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                      {n.title}
                      {unread && <span className="inline-block w-1.5 h-1.5 rounded-full ml-1.5 mb-0.5 align-middle" style={{ background: 'var(--text)' }} />}
                    </h4>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>{timeAgo(n.created_at)}</span>
                  </div>
                  <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>{n.message}</p>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs" style={{ color: 'var(--text-3)' }}>
                    <span>By {n.sent_by_name || 'Admin'}</span>
                    {n.area_name
                      ? <span className="flex items-center gap-1"><MapPin size={10} /> {n.area_name} only</span>
                      : <span>All workers</span>}
                    {isAdmin && (
                      <span className="ml-auto font-medium">
                        {n.read_count||0}/{n.total_recipients||0} read
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
