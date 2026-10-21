// End-of-trip notification. Quick actions use the last car picked; tapping the notification opens the trip to change car or purpose.
import * as Notifications from 'expo-notifications';
import { promptFor, type Car } from './detector';
import type { LocalTrip } from './db';

export const CAT_REIMB = 'trip_reimbursable', CAT_LOG = 'trip_log';
export async function setupNotifications() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  await Notifications.setNotificationCategoryAsync(CAT_REIMB, [
    { identifier: 'send', buttonTitle: 'Business · Send now', options: { opensAppToForeground: true } },
    { identifier: 'batch', buttonTitle: 'Business · Batch Friday', options: { opensAppToForeground: true } },
    { identifier: 'personal', buttonTitle: 'Personal', options: { opensAppToForeground: true } }]);
  await Notifications.setNotificationCategoryAsync(CAT_LOG, [
    { identifier: 'log', buttonTitle: 'Business (log only)', options: { opensAppToForeground: true } },
    { identifier: 'personal', buttonTitle: 'Personal', options: { opensAppToForeground: true } }]);
}
export async function askPermission() { const p = await Notifications.requestPermissionsAsync(); return p.granted; }
export async function notifyTripEnded(t: LocalTrip, lastCar: Car | undefined) {
  const p = promptFor(lastCar);
  await Notifications.scheduleNotificationAsync({ identifier: t.clientId, trigger: null, content: {
    title: `${t.miles} mi trip, ${t.durationMin} min. Business?`,
    body: lastCar ? `Car: ${lastCar.name}${p.note ? '. ' + p.note : ''} Tap to change the car.` : 'Tap to pick the car.',
    categoryIdentifier: p.reimbursable ? CAT_REIMB : CAT_LOG, data: { clientId: t.clientId } } });
}

// Gentle nudge for trips nobody answered: one quiet reminder each evening at 6 PM while any are waiting.
// Unanswered trips are never uploaded or reimbursed; they wait in "Needs review" until the driver decides.
export const REVIEW_REMINDER = 'review-reminder';
export async function scheduleReviewReminder(count: number) {
  await Notifications.cancelScheduledNotificationAsync(REVIEW_REMINDER).catch(() => {});
  if (!count) return;
  await Notifications.scheduleNotificationAsync({ identifier: REVIEW_REMINDER, content: {
    title: `${count} trip${count > 1 ? 's' : ''} to review`, body: 'Business or personal? Open Ovanova Moves to sort them in one go.', sound: false },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 18, minute: 0 } });
}
