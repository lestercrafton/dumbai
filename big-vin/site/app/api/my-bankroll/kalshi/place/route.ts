import {currentUser} from '@/lib/my-bankroll-session';
import {placeForUser} from '@/lib/my-bankroll-kalshi';

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401});
    const body = await request.json().catch(() => null) as {
      confirm?: unknown;
      wagerDollars?: unknown;
      ticker?: unknown;
      side?: unknown;
      yesAskDollars?: unknown;
      clientOrderId?: unknown;
    } | null;
    if (!body?.confirm) return Response.json({error: 'Confirm the order first.'}, {status: 400});
    const wager = Number(body?.wagerDollars);
    if (!body?.ticker || !Number.isFinite(wager) || wager <= 0) {
      return Response.json({error: 'Missing ticker or wager.'}, {status: 400});
    }
    if (wager > 25_000) return Response.json({error: 'Wager too large for this form.'}, {status: 400});
    const result = await placeForUser(user.id, {
      ticker: String(body.ticker),
      side: body.side === 'no' ? 'no' : 'yes',
      wagerDollars: wager,
      yesAskDollars: body.yesAskDollars as string | number | null | undefined,
      clientOrderId: typeof body.clientOrderId === 'string' ? body.clientOrderId : undefined,
    });
    if (!result.ok) return Response.json({error: result.error, detail: (result as any).detail}, {status: (result as any).status || 400});
    return Response.json({ok: true, order: result.order, submitted: result.submitted}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi place', e instanceof Error ? e.message : e);
    return Response.json({error: 'Could not place order.'}, {status: 503});
  }
}
