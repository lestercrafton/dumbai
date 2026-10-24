/** Kalshi personal referral / invite code hook for Big Vin deep links.
 *
 * Kalshi's public program is refer-a-friend trading credits (not a cash
 * affiliate CPA). Set Worker env KALSHI_REFERRAL_CODE to a code or full
 * invite URL from Explore → Your rewards when Lester has one.
 */

export function normalizeKalshiReferralCode(raw) {
  const c = String(raw || '').trim();
  return c || null;
}

/** Append referral to a Kalshi market or site URL when a code is configured. */
export function applyKalshiReferral(url, code) {
  if (!url || !code) return url || null;
  if (/^https?:\/\//i.test(code)) {
    // Full invite URL — leave market deep links alone; callers use join URL separately.
    return url;
  }
  try {
    const u = new URL(url);
    if (u.searchParams.has('r') || u.searchParams.has('referral_code')) return u.toString();
    u.searchParams.set('r', code);
    return u.toString();
  } catch {
    return url;
  }
}

/** Signup / "Open Kalshi" landing when a referral is configured. */
export function kalshiJoinUrl(code) {
  const c = normalizeKalshiReferralCode(code);
  if (!c) return 'https://kalshi.com';
  if (/^https?:\/\//i.test(c)) return c;
  return `https://kalshi.com/?r=${encodeURIComponent(c)}`;
}

/** Stamp every match url with the referral query when code is a bare token. */
export function applyReferralToMatches(result, code) {
  const c = normalizeKalshiReferralCode(code);
  if (!c || !result?.matches) return result;
  const matches = {};
  for (const [id, m] of Object.entries(result.matches)) {
    if (!m || typeof m !== 'object') {
      matches[id] = m;
      continue;
    }
    matches[id] = m.url ? {...m, url: applyKalshiReferral(m.url, c)} : m;
  }
  return {...result, matches, referralConfigured: !!c, joinUrl: kalshiJoinUrl(c)};
}
