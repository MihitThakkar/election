export default function Modal({ title, onClose, children, wide = false }) {
  return (
    <div
      className="modal-backdrop"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`modal-content ${wide ? 'max-w-2xl' : ''}`}>
        <div className="flex items-center justify-between p-5"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-lg leading-none
                       transition-all hover:bg-black hover:text-white"
            style={{ color: 'var(--text-3)' }}
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
