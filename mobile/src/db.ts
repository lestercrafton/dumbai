// Local storage on the phone (SQLite). Trips survive restarts and are retried until the server accepts them.
import * as SQLite from 'expo-sqlite';
import type { Car, CompletedTrip, DetectorState } from './detector';

export type Category = 'business' | 'personal' | null;
export type Action = 'send' | 'batch' | 'log' | null;
export type LocalTrip = CompletedTrip & { clientId: string; carId: string | null; category: Category; action: Action; purpose: string;
  synced: 0 | 1; serverStatus: string | null; serverError: string | null; route?: string };

let dbp: Promise<SQLite.SQLiteDatabase> | null = null;
export function db() {
  return dbp ??= SQLite.openDatabaseAsync('mileage.db').then(async d => {
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
export async function needsReviewCount() { return (await trips(500)).filter(t => !t.category).length; }
