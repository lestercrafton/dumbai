import {currentUser} from '@/lib/my-bankroll-session';
import {retestKalshi} from '@/lib/my-bankroll-kalshi';

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401});
    const result = await retestKalshi(user.id);
    if (!result.ok) return Response.json({error: result.error}, {status: result.status || 400});
    return Response.json({ok: true, balance: result.balance}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi test', e instanceof Error ? e.message : e);
    return Response.json({error: 'Kalshi test failed.'}, {status: 503});
  }
}
