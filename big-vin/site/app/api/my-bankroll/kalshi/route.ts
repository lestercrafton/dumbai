import {currentUser} from '@/lib/my-bankroll-session';
import {loadKalshiStatus, saveKalshiCredentials, disconnectKalshi} from '@/lib/my-bankroll-kalshi';

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401, headers: {'Cache-Control': 'no-store'}});
    const status = await loadKalshiStatus(user.id);
    return Response.json({kalshi: status}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi status', e);
    return Response.json({error: 'Unavailable.'}, {status: 503});
  }
}

export async function PUT(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401});
    const body = await request.json().catch(() => null) as {
      apiKeyId?: unknown;
      privateKeyPem?: unknown;
      goFull?: unknown;
    } | null;
    const result = await saveKalshiCredentials(user.id, {
      apiKeyId: typeof body?.apiKeyId === 'string' ? body.apiKeyId : '',
      privateKeyPem: typeof body?.privateKeyPem === 'string' ? body.privateKeyPem : '',
      goFull: body?.goFull !== false,
    });
    if (!result.ok) return Response.json({error: result.error}, {status: result.status || 400});
    const status = await loadKalshiStatus(user.id);
    return Response.json({ok: true, balance: result.balance, kalshi: status}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi connect', e instanceof Error ? e.message : e);
    return Response.json({error: 'Could not save Kalshi credentials.'}, {status: 503});
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({error: 'Sign in first.'}, {status: 401});
    await disconnectKalshi(user.id);
    return Response.json({ok: true, kalshi: {connected: false, goFull: false}}, {headers: {'Cache-Control': 'no-store'}});
  } catch (e) {
    console.error('kalshi disconnect', e);
    return Response.json({error: 'Could not disconnect.'}, {status: 503});
  }
}
