// Reimbursement recipient rules, mirrored on the server: @ovanova.co accounts send only to @ovanova.co;
// everyone else may use any address but has no default and never Sugar.
export function recipientError(to: string, ovanova: boolean): string | null {
  const v = to.trim(); if (!v) return ovanova ? 'Enter an @ovanova.co address' : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'That doesn’t look like an email address';
  if (ovanova && !/@ovanova\.co$/i.test(v)) return 'Ovanova accounts send reimbursements to an @ovanova.co address';
  if (!ovanova && /^sugar@ovanova\.co$/i.test(v)) return 'Enter the address that handles your reimbursements';
  return null;
}
