// Talks to the Vercel API. Sign-in is "Sign in with Google": the server runs the OAuth flow and hands back a session token.
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type { Car } from './detector';
import { getKv, setKv, unsynced, patchTrip, replaceCars, setCurrentUser } from './db';

export const DEFAULT_SERVER = 'https://ovanova-mileage-tesla.vercel.app';
export const getServer = () => getKv<string>('server', DEFAULT_SERVER);
export const setServer = (u: string) => setKv('server', u.replace(/\/$/, ''));
export const getToken = () => SecureStore.getItemAsync('deviceToken');
export const setToken = (t: string) => SecureStore.setItemAsync('deviceToken', t.trim());
export const APP_REDIRECT = 'ovanovamileage://auth';

// Opens Google's sign-in in a secure browser sheet; returns the signed-in email, or throws with a readable message.
export async function signInWithGoogle(): Promise<{ email: string; name: string; missing: string[] }> {
  const server = await getServer();
  const r = await WebBrowser.openAuthSessionAsync(`${server}/api/phone/auth/start?redirect=${encodeURIComponent(APP_REDIRECT)}`, APP_REDIRECT);
  if (r.type !== 'success') throw new Error('Sign-in was cancelled');
  const back = new URL(r.url), err = back.searchParams.get('error'); if (err) throw new Error(err);
  const res = await fetch(server + '/api/phone/auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: back.searchParams.get('code') }) });
  const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || 'Sign-in failed');
  await setToken(j.token); await setCurrentUser(j.email);
  return { email: j.email, name: j.name, missing: (back.searchParams.get('missing') || '').split(',').filter(Boolean) };
}
export async function signOut(revoke = false) { try { await call('POST', '/api/phone/auth/signout', { revoke }); } catch {} await SecureStore.deleteItemAsync('deviceToken'); await setCurrentUser(null); }
// Builds a Google Sheet of trips between two dates (YYYY-MM-DD) in the user's own Drive; returns its link.
export const exportSheet = (from: string, to: string) => call<{ id: string; url: string }>('POST', '/api/phone/export', { from, to });

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken(); if (!token) throw new Error('Sign in with Google first (Settings tab)');
  const r = await fetch((await getServer()) + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error ' + r.status);
  return j as T;
}
export type Me = { email: string; name: string; sugar: string; sugarCc: string; nextBatch: string; emailReady: boolean; emailVia: 'gmail' | 'smtp' | null; driveReady: boolean };
export const saveRecipient = (sugar: string, sugarCc: string) => call<{ sugar: string; sugarCc: string }>('PUT', '/api/phone/settings', { sugar, sugarCc });
export const me = () => call<Me>('GET', '/api/phone/me');
export async function pullCars(): Promise<Car[]> { const { cars } = await call<{ cars: Car[] }>('GET', '/api/phone/cars'); await replaceCars(cars); return cars; }
export async function pushCars(list: Car[]): Promise<Car[]> { const { cars } = await call<{ cars: Car[] }>('PUT', '/api/phone/cars', { cars: list }); await replaceCars(cars); return cars; }

type Result = { clientId: string; status?: string; error?: string };
// Upload every tagged trip that the server hasn't accepted yet. Untagged trips stay local until answered.
export async function sync(): Promise<{ uploaded: number; sendError?: string | null }> {
  const pending = (await unsynced()).filter(t => t.category);
  if (!pending.length) return { uploaded: 0 };
  const res = await call<{ results: Result[]; sendError: string | null }>('POST', '/api/phone/trips', { trips: pending.map(t => ({
    clientId: t.clientId, startTime: t.startTime, endTime: t.endTime, miles: t.miles, startLoc: t.startLoc, endLoc: t.endLoc,
    carId: t.carId, category: t.category, action: t.action, purpose: t.purpose, route: t.route })) });
  for (const t of pending) { const r = res.results.find(x => x.clientId === t.clientId); if (!r) continue;
    // If the driver changed the answer while this upload was in flight, keep it unsynced so the new answer goes up next.
    await patchTrip(t.clientId, cur => { const same = cur.category === t.category && cur.action === t.action && cur.carId === t.carId;
      return { ...cur, serverStatus: same ? r.status || null : cur.serverStatus, serverError: r.error || null, synced: same && !r.error ? 1 : 0 }; }); }
  return { uploaded: pending.length, sendError: res.sendError };
}
