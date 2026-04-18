import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Vote, Phone, Lock, AlertCircle } from 'lucide-react';

export default function Login() {
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const { login }   = useAuth();
  const navigate    = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const user = await login(phone, password);
      const dest = ['super_admin', 'team_lead'].includes(user.role) ? '/' : '/my-list';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally { setLoading(false); }
  };

  const fill = (p, pw) => { setPhone(p); setPassword(pw); setError(''); };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--sidebar-bg)' }}
    >
      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(rgba(148,163,184,.18) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      {/* Indigo center glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 65% 50% at 50% 50%, rgba(99,102,241,.10) 0%, transparent 70%)' }}
      />

      <div className="w-full max-w-md relative anim-up">
        {/* Logo mark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
            style={{ background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.40)', animation: 'bounce-in .4s ease' }}>
            <Vote size={30} style={{ color: '#A5B4FC' }} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: '#F8FAFC' }}>Election Manager</h1>
          <p className="text-sm mt-1.5" style={{ color: 'rgba(148,163,184,.75)' }}>Campaign Field Operations System</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8 anim-up anim-d1"
          style={{
            background: 'var(--surface)',
            boxShadow: '0 24px 64px rgba(0,0,0,.45), 0 4px 16px rgba(0,0,0,.2)',
          }}>
          <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--text)' }}>Sign In</h2>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg mb-4 text-sm anim-down"
              style={{ background: 'var(--bg)', border: '1.5px solid var(--border)', color: 'var(--text-2)' }}>
              <AlertCircle size={15} className="flex-shrink-0" style={{ color: 'var(--text)' }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Phone Number</label>
              <div className="relative">
                <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-3)' }} />
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="10-digit phone number" className="input pl-9"
                  required maxLength={10} inputMode="numeric" />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--text-3)' }} />
                <input type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password" className="input pl-9 pr-10" required />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-3)' }}>
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full btn-primary justify-center py-3 text-base mt-2">
              {loading
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Signing in...</>
                : 'Sign In →'}
            </button>
          </form>

        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(148,163,184,.55)' }}>
          S20-155 · Part 275 · 2026 Election Campaign
        </p>
      </div>
    </div>
  );
}
