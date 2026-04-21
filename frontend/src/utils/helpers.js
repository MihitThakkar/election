// ── Time formatting ──────────────────────────────────────────────────────────
export function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Voter helpers ─────────────────────────────────────────────────────────────
export const isEligible = (age) => age >= 18 && age <= 35;

// DB enum values kept as ('pending','done','refused') — UI relabels them as
// Pending / Approved / Rejected to match the team-review workflow.
export const STATUS_CONFIG = {
  done:    { label: 'Approved', badge: 'badge-green', borderClass: 'status-done',    bg: '' },
  refused: { label: 'Rejected', badge: 'badge-red',   borderClass: 'status-refused', bg: '' },
  pending: { label: 'Pending',  badge: 'badge-amber', borderClass: 'status-pending', bg: '' },
};

export function voterStatusLabel(status) {
  return STATUS_CONFIG[status]?.label ?? 'Pending';
}

// ── API error extraction ──────────────────────────────────────────────────────
export function getApiError(err, fallback = 'Something went wrong. Please try again.') {
  return err?.response?.data?.error || fallback;
}
