import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, Users, MapPin, Upload, List, Search,
  Bell, Video, LogOut, Menu, X, Vote
} from 'lucide-react';

const navByRole = {
  super_admin: [
    { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/team',        icon: Users,           label: 'Manage Team' },
    { to: '/areas',       icon: MapPin,          label: 'Villages & Parts' },
    { to: '/upload',      icon: Upload,          label: 'Upload Voters' },
    { to: '/voters',      icon: List,            label: 'Voter List' },
  ],
  team_lead: [
    { to: '/',            icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/team',        icon: Users,           label: 'My Team' },
    { to: '/voters',      icon: List,            label: 'Voter List' },
  ],
  field_worker: [
    { to: '/my-list',     icon: List,            label: 'My Voter List' },
    { to: '/team',        icon: Users,           label: 'My Sub-Workers' },
  ],
  sub_worker: [
    { to: '/my-list',     icon: List,            label: 'My Voter List' },
  ],
};
const sharedNav = [
  { to: '/search',        icon: Search, label: 'Global Search' },
  { to: '/notifications', icon: Bell,   label: 'Notifications', badge: true },
  { to: '/video-guide',   icon: Video,  label: 'Video Guide' },
];

/* Sidebar palette — slate-800 dark sidebar, indigo accent */
const C = {
  text:      'rgba(255,255,255,.90)',
  textMuted: 'rgba(255,255,255,.42)',
  divider:   'rgba(255,255,255,.07)',
  activeBg:  'rgba(99,102,241,.20)',  /* indigo-500 at 20% */
  activeText:'#A5B4FC',               /* indigo-300 */
  hoverBg:   'rgba(255,255,255,.06)',
  avatarBg:  'rgba(255,255,255,.11)',
  badgeBg:   '#6366F1',               /* indigo-500 */
  badgeText: '#FFFFFF',
  logoBg:    '#FFFFFF',
  logoIcon:  '#4F46E5',               /* indigo-600 */
};

function NavItem({ item, active, unreadCount }) {
  return (
    <Link
      to={item.to}
      className="relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group"
      style={{
        color:      active ? C.activeText : C.textMuted,
        background: active ? C.activeBg : 'transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.hoverBg; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <span className="nav-active-bar" />}
      <item.icon size={17} className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
      <span className="flex-1">{item.label}</span>
      {item.badge && unreadCount > 0 && (
        <span className="text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
          style={{ background: C.badgeBg, color: C.badgeText }}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}

const roleLabels = { super_admin: 'Super Admin', team_lead: 'Team Lead', field_worker: 'Field Worker', sub_worker: 'Sub Worker' };

function Sidebar({ user, navItems, unreadCount, location, onLogout }) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: C.logoBg }}>
          <Vote size={19} style={{ color: C.logoIcon }} />
        </div>
        <div>
          <div className="font-bold text-sm leading-tight tracking-tight" style={{ color: C.text }}>Election Manager</div>
          <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>Campaign Operations</div>
        </div>
      </div>

      {/* User */}
      <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: C.avatarBg, color: C.text }}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: C.text }}>{user?.name}</div>
            <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {roleLabels[user?.role] || user?.role}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        {navItems.map(item => (
          <NavItem key={item.to} item={item} active={location.pathname === item.to} unreadCount={unreadCount} />
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4" style={{ borderTop: `1px solid ${C.divider}` }}>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group"
          style={{ color: C.textMuted }}
          onMouseEnter={e => { e.currentTarget.style.background = C.hoverBg; e.currentTarget.style.color = 'rgba(255,255,255,.85)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMuted; }}
        >
          <LogOut size={17} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, unreadCount } = useAuth();
  const location = useLocation();
  const navigate  = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const roleNav  = navByRole[user?.role] || [];
  const navItems = [...roleNav, ...sharedNav];

  const handleLogout = () => { logout(); navigate('/login'); };

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const sidebarProps = { user, navItems, unreadCount, location, onLogout: handleLogout };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 flex-shrink-0" style={{ background: 'var(--sidebar-bg)' }}>
        <Sidebar {...sidebarProps} />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0"
            style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setSidebarOpen(false)}
          />
          <div
            className="relative w-64 flex flex-col"
            style={{ background: 'var(--sidebar-bg)', animation: 'slideLeft .22s ease' }}
          >
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
            <Sidebar {...sidebarProps} />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden border-b px-4 py-3 flex items-center gap-3 flex-shrink-0"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg transition-all hover:bg-black hover:text-white"
            style={{ color: 'var(--text)' }}
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Vote size={17} style={{ color: 'var(--text)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Election Manager</span>
          </div>
          {unreadCount > 0 && (
            <Link to="/notifications" className="ml-auto relative">
              <Bell size={20} style={{ color: 'var(--text)' }} />
              <span className="absolute -top-1 -right-1 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center"
                style={{ background: 'var(--text)', color: 'var(--surface)' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </Link>
          )}
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
