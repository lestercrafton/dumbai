import {env} from 'cloudflare:workers';
import {currentUser} from '@/lib/my-bankroll-session';
import {loadCatalogs} from '@/lib/kalshi-api.mjs';
import {matchPicks, SERIES_BY_SPORT} from '@/lib/kalshi-match.mjs';
import {applyReferralToMatches, normalizeKalshiReferralCode} from '@/lib/kalshi-referral.mjs';

type ReferralEnv = {KALSHI_REFERRAL_CODE?: string};

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401, headers: {'Cache-Control': 'no-store'}});
    const body = await request.json().catch(() => null) as {picks?: unknown} | null;
    const picks = Array.isArray(body?.picks) ? body.picks.slice(0, 200) : [];
    const seriesBySport = SERIES_BY_SPORT as Record<string, unknown>;
    const sports = [...new Set(picks.map((p: any) => p?.sport).filter((s: string) => s && seriesBySport[s]))] as string[];
    if (!sports.length) return Response.json({matches: {}, matched: 0, total: 0}, {headers: {'Cache-Control': 'no-store'}});
    const catalogs = await loadCatalogs(sports);
    const result = matchPicks(picks, catalogs);
    const code = normalizeKalshiReferralCode((env as unknown as ReferralEnv).KALSHI_REFERRAL_CODE);
    const stamped = applyReferralToMatches(result, code);
    return Response.json(stamped, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi matches', e instanceof Error ? e.message : e);
    return Response.json({error: 'Kalshi markets unavailable.', matches: {}, matched: 0, total: 0}, {status: 503});
  }
}
