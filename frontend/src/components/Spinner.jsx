export function PageSpinner({ message = '' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 anim-fade">
      <div className="w-7 h-7 border-[3px] border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--border)', borderTopColor: 'transparent' }}>
        <style>{`.animate-spin { animation: spin .7s linear infinite }`}</style>
      </div>
      {message && <p className="text-sm" style={{ color: 'var(--text-3)' }}>{message}</p>}
    </div>
  );
}

export function InlineSpinner({ size = 4, light = false }) {
  return (
    <div
      className={`w-${size} h-${size} border-2 border-t-transparent rounded-full animate-spin`}
      style={{ borderColor: light ? 'rgba(255,255,255,.4)' : 'var(--border)', borderTopColor: 'transparent' }}
    />
  );
}

export function TableSpinner({ cols = 6 }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-12 text-center">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto"
          style={{ borderColor: 'var(--border)', borderTopColor: 'transparent' }} />
      </td>
    </tr>
  );
}
