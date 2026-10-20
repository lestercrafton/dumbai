// Talks to the Vercel API. The server URL and device token are entered once in Settings.
import * as SecureStore from 'expo-secure-store';
import type { Car } from './detector';
import { getKv, setKv, unsynced, saveTrip, replaceCars, type LocalTrip } from './db';

export const DEFAULT_SERVER = 'https://ovanova-mileage-tesla.vercel.app';
export const getServer = () => getKv<string>('server', DEFAULT_SERVER);
export const setServer = (u: string) => setKv('server', u.replace(/\/$/, ''));
export const getToken = () => SecureStore.getItemAsync('deviceToken');
export const setToken = (t: string) => SecureStore.setItemAsync('deviceToken', t.trim());

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken(); if (!token) throw new Error('Pair this phone first (Settings → device token)');
  const r = await fetch((await getServer()) + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error ' + r.status);
  return j as T;
}
export type Me = { email: string; name: string; sugar: string; nextBatch: string; emailReady: boolean; driveReady: boolean };
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
    carId: t.carId, category: t.category, action: t.action, purpose: t.purpose })) });
  for (const t of pending) { const r = res.results.find(x => x.clientId === t.clientId); if (!r) continue;
    const upd: LocalTrip = { ...t, serverStatus: r.status || null, serverError: r.error || null, synced: r.error ? 0 : 1 };
    await saveTrip(upd); }
  return { uploaded: pending.length, sendError: res.sendError };
}
