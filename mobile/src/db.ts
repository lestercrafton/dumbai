// Local storage on the phone (SQLite). Trips survive restarts and are retried until the server accepts them.
import * as SQLite from 'expo-sqlite';
import type { Car, CompletedTrip, DetectorState } from './detector';

export type Category = 'business' | 'personal' | null;
export type Action = 'send' | 'batch' | 'log' | null;
export type LocalTrip = CompletedTrip & { clientId: string; carId: string | null; category: Category; action: Action; purpose: string;
  synced: 0 | 1; serverStatus: string | null; serverError: string | null; route?: string;
  amount?: number | null; reimbursedAt?: string | null };

// Each signed-in Google account gets its own database file, so cars and trips never mix between users on one phone.
// The original mileage.db stays with the first account that signs in after this change (the phone's owner).
let sp: Promise<SQLite.SQLiteDatabase> | null = null;
const session = () => sp ??= SQLite.openDatabaseAsync('session.db').then(async d => { await d.execAsync('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);'); return d; });
async function sget(k: string) { return (await (await session()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k))?.v ?? null; }
async function sset(k: string, v: string | null) { const d = await session(); if (v == null) await d.runAsync('DELETE FROM kv WHERE k = ?', k); else await d.runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, v); }
export const currentUser = () => sget('currentUser');
export async function setCurrentUser(email: string | null) {
  const e = email ? email.trim().toLowerCase() : null;
  if (e && !(await sget('legacyOwner'))) await sset('legacyOwner', e);
  await sset('currentUser', e); dbp = null;
}
export async function dbFileFor(email: string | null) {
  const legacy = await sget('legacyOwner');
  return !email || email === legacy ? 'mileage.db' : 'u-' + email.replace(/[^a-z0-9]+/g, '_') + '.db';
}
let dbp: Promise<SQLite.SQLiteDatabase> | null = null;
export function db() {
  return dbp ??= currentUser().then(dbFileFor).then(name => SQLite.openDatabaseAsync(name)).then(async d => {
    await d.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cars (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS trips (clientId TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, startTime TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0);`);
    return d;
  });
}
export async function getKv<T>(k: string, d: T): Promise<T> { const r = await (await db()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k); return r ? JSON.parse(r.v) : d; }
export async function setKv(k: string, v: unknown) { await (await db()).runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, JSON.stringify(v)); }

export const getDetector = () => getKv<DetectorState | null>('detector', null);
export const setDetector = (s: DetectorState) => setKv('detector', s);
export const getLastCarId = () => getKv<string | null>('lastCarId', null);
export const setLastCarId = (id: string) => setKv('lastCarId', id);

export async function cars(): Promise<Car[]> { return (await (await db()).getAllAsync<{ json: string }>('SELECT json FROM cars ORDER BY sort, id')).map(r => JSON.parse(r.json)); }
export async function replaceCars(list: Car[]) {
  const d = await db();
  await d.withTransactionAsync(async () => { await d.runAsync('DELETE FROM cars'); let i = 0; for (const c of list) await d.runAsync('INSERT INTO cars (id, json, sort) VALUES (?, ?, ?)', c.id, JSON.stringify(c), i++); });
}

export async function trips(limit = 100): Promise<LocalTrip[]> { return (await (await db()).getAllAsync<{ json: string }>('SELECT json FROM trips ORDER BY startTime DESC LIMIT ?', limit)).map(r => JSON.parse(r.json)); }
export async function trip(clientId: string): Promise<LocalTrip | null> { const r = await (await db()).getFirstAsync<{ json: string }>('SELECT json FROM trips WHERE clientId = ?', clientId); return r ? JSON.parse(r.json) : null; }
// All trip writes go through one queue so a slow writer (route lookup, sync) can never overwrite a newer answer.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }
async function write(t: LocalTrip) { await (await db()).runAsync('INSERT OR REPLACE INTO trips (clientId, json, startTime, synced) VALUES (?, ?, ?, ?)', t.clientId, JSON.stringify(t), t.startTime, t.synced); }
export const saveTrip = (t: LocalTrip) => serial(() => write(t));
// Read-modify-write one trip atomically. The updater gets the current row; return null to leave it unchanged.
export const patchTrip = (clientId: string, fn: (cur: LocalTrip) => LocalTrip | null) => serial(async () => {
  const cur = await trip(clientId); if (!cur) return null; const next = fn(cur); if (next) await write(next); return next; });
export async function unsynced(): Promise<LocalTrip[]> { return (await (await db()).getAllAsync<{ json: string }>('SELECT json FROM trips WHERE synced = 0 ORDER BY startTime')).map(r => JSON.parse(r.json)); }
// Same name + model (ignoring case and spaces) is the same car.
export const carKey = (c: Car) => [c.name, c.model || ''].map(x => x.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
// Points local trips at a kept car after duplicates were merged.
export async function remapCars(remap: Record<string, string>) {
  if (!Object.keys(remap).length) return;
  for (const t of await trips(1000)) if (t.carId && remap[t.carId]) await patchTrip(t.clientId, cur => cur.carId && remap[cur.carId] ? { ...cur, carId: remap[cur.carId], synced: cur.category ? 0 : cur.synced } : null);
}
// One-time cleanup after Tesla support was removed: plain cars, and trips once "Counted by Tesla" go back to review.
export async function migrateNoTesla() {
  if (await getKv('migratedNoTesla', false)) return;
  const list = await cars(); await replaceCars(list.map(({ isTesla, teslaId, ...c }: any) => c));
  for (const t of await trips(1000)) if (t.serverStatus === 'superseded')
    await patchTrip(t.clientId, cur => ({ ...cur, category: null, action: null, synced: 0, serverStatus: null, serverError: null }));
  await setKv('migratedNoTesla', true);
}
export async function needsReviewCount() { return (await trips(500)).filter(t => !t.category).length; }
