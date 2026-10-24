import {currentUser} from '@/lib/my-bankroll-session';
import {loadCatalogs} from '@/lib/kalshi-api.mjs';
import {matchPicks, SERIES_BY_SPORT} from '@/lib/kalshi-match.mjs';

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401, headers: {'Cache-Control': 'no-store'}});
    const body = await request.json().catch(() => null);
    const picks = Array.isArray(body?.picks) ? body.picks.slice(0, 200) : [];
    const sports = [...new Set(picks.map((p: any) => p?.sport).filter((s: string) => s && SERIES_BY_SPORT[s]))] as string[];
    if (!sports.length) return Response.json({matches: {}, matched: 0, total: 0}, {headers: {'Cache-Control': 'no-store'}});
    const catalogs = await loadCatalogs(sports);
    const result = matchPicks(picks, catalogs);
    return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi matches', e instanceof Error ? e.message : e);
    return Response.json({error: 'Kalshi markets unavailable.', matches: {}, matched: 0, total: 0}, {status: 503});
  }
}
