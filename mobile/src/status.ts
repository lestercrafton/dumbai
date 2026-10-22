// What a trip is, as the server decides it (lib/phone.js status), read the same way the web page reads it.
// Before the server has answered, the driver's own choice stands in for it.
export type TripStatus = 'untagged' | 'personal' | 'log only' | 'reimbursable' | 'queued' | 'sent';
export type StatusInput = { category: 'business' | 'personal' | null; action: 'send' | 'batch' | 'log' | null; serverStatus: string | null;
  amount?: number | null; reimbursedAt?: string | null; synced?: 0 | 1 };

export function statusOf(t: StatusInput, companyCar: boolean): TripStatus {
  if (!t.category) return 'untagged';
  if (t.category === 'personal') return 'personal';
  const s = t.serverStatus;
  if (s === 'sent' || s === 'queued' || s === 'reimbursable' || s === 'log only') return s;
  if (s === 'superseded') return 'log only';
  if (companyCar || t.action === 'log') return 'log only';
  return t.action === 'batch' ? 'queued' : 'reimbursable';
}

const usd = (n: number) => '$' + n.toFixed(2);
const short = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// The quiet line beside "Business" on an answered card. Personal trips get nothing: no money, no buttons.
export function summaryMeta(t: StatusInput, st: TripStatus, batchName = 'Friday batch'): string {
  const amt = t.amount != null ? ' · ' + usd(t.amount) : '';
  switch (st) {
    case 'sent': return (t.reimbursedAt ? 'Sent ' + short(t.reimbursedAt) : 'Sent') + amt;
    case 'queued': return batchName + amt;
    case 'reimbursable': return (t.action === 'send' && !t.synced ? 'Sending now' : 'Not sent yet') + amt;
    case 'log only': return 'Logged · company car';
    default: return '';
  }
}
