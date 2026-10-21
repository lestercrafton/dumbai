// Always-on background location task. Must be imported at app start (index.ts) so iOS can relaunch it.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Crypto from 'expo-crypto';
import { feed, flush, initialState, type Fix } from './detector';
import { currentUser, getDetector, setDetector, saveTrip, cars, getLastCarId, needsReviewCount, type LocalTrip } from './db';
import { notifyTripEnded, scheduleReviewReminder } from './notify';

export const LOCATION_TASK = 'mileage-location';

async function onTrip(t: NonNullable<ReturnType<typeof feed>['trip']>) {
  const lastId = await getLastCarId(), list = await cars(), car = list.find(c => c.id === lastId);
  const local: LocalTrip = { ...t, clientId: Crypto.randomUUID(), carId: car ? car.id : null, category: null, action: null, purpose: '', synced: 0, serverStatus: null, serverError: null };
  await saveTrip(local); await notifyTripEnded(local, car); await scheduleReviewReminder(await needsReviewCount());
}
export async function processFixes(fixes: Fix[], now = Date.now()) {
  if (!(await currentUser())) return; // signed out: record nothing
  let s = (await getDetector()) || initialState();
  for (const f of fixes.sort((a, b) => a.ts - b.ts)) { const r = feed(s, f); s = r.state; if (r.trip) await onTrip(r.trip); }
  const r = flush(s, now); s = r.state; if (r.trip) await onTrip(r.trip);
  await setDetector(s);
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  await processFixes(data.locations.map(l => ({ ts: l.timestamp, lat: l.coords.latitude, lon: l.coords.longitude, speed: l.coords.speed, accuracy: l.coords.accuracy })));
});

export async function startTracking(): Promise<string | null> {
  const fg = await Location.requestForegroundPermissionsAsync(); if (fg.status !== 'granted') return 'Location permission is needed.';
  const bg = await Location.requestBackgroundPermissionsAsync(); if (bg.status !== 'granted') return 'Choose "Always" for location in iPhone Settings → Mileage → Location.';
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return null;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 5000,
    activityType: Location.ActivityType.AutomotiveNavigation, pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: false, deferredUpdatesInterval: 0 });
  return null;
}
export async function stopTracking() { if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK); }
export const isTracking = () => Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
