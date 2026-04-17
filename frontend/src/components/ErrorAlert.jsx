import { AlertCircle } from 'lucide-react';

export default function ErrorAlert({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg mb-4 anim-down"
      style={{
        background: '#f5f5f5',
        border: '1.5px solid #ddd',
        color: 'var(--text)',
      }}>
      <AlertCircle size={14} className="flex-shrink-0" style={{ color: 'var(--text-2)' }} />
      <span>{message}</span>
    </div>
  );
}
