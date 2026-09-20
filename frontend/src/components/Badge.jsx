const LABELS = { success: "Success", retried: "Retried", failed: "Failed" };

export default function Badge({ outcome }) {
  if (!outcome) return <span className="badge badge-none">Queued</span>;
  return <span className={`badge badge-${outcome}`}>{LABELS[outcome] || outcome}</span>;
}
