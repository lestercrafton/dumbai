import {
  addDays,
  addMinutes,
  startOfDay,
  endOfDay,
  format,
  isBefore,
  isAfter,
  parseISO,
  setHours,
  setMinutes,
  getDay,
  max as dateMax,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";

interface Slot {
  start: Date;
  end: Date;
}

interface GetSlotsParams {
  eventTypeSlug: string;
  dateStr: string; // YYYY-MM-DD
  timeZone: string;
}

export async function getAvailableSlots({
  eventTypeSlug,
  dateStr,
  timeZone,
}: GetSlotsParams): Promise<Slot[]> {
  const eventType = await db.eventType.findUnique({
    where: { slug: eventTypeSlug },
    include: { owner: true },
  });
  if (!eventType || !eventType.active) return [];

  const hostId = eventType.ownerId;
  if (!hostId) return [];

  const host = await db.user.findUnique({ where: { id: hostId } });
  if (!host) return [];

  const hostTz = host.timeZone;
  const requestedDate = parseISO(dateStr);
  const dayOfWeek = getDay(requestedDate);

  // Get host's availability for this day of week
  const avail = await db.availability.findUnique({
    where: { userId_dayOfWeek: { userId: hostId, dayOfWeek } },
  });
  if (!avail) return [];

  // Check for date overrides
  const dayStart = startOfDay(requestedDate);
  const dayEnd = endOfDay(requestedDate);
  const override = await db.dateOverride.findFirst({
    where: {
      userId: hostId,
      date: { gte: dayStart, lte: dayEnd },
    },
  });

  if (override && !override.available) return [];

  const workStart = override?.startTime ?? avail.startTime;
  const workEnd = override?.endTime ?? avail.endTime;

  const [startH, startM] = workStart.split(":").map(Number);
  const [endH, endM] = workEnd.split(":").map(Number);

  // Build window in host's timezone, then convert to UTC
  const hostDayStart = fromZonedTime(
    setMinutes(setHours(requestedDate, startH), startM),
    hostTz
  );
  const hostDayEnd = fromZonedTime(
    setMinutes(setHours(requestedDate, endH), endM),
    hostTz
  );

  const duration = eventType.durationMinutes;
  const bufferBefore = eventType.bufferBefore;
  const bufferAfter = eventType.bufferAfter;
  const minNotice = eventType.minNoticeMinutes;

  // Earliest bookable time (now + minNotice)
  const earliest = addMinutes(new Date(), minNotice);

  // Get existing bookings for the host on this day
  const existingBookings = await db.booking.findMany({
    where: {
      hostId,
      status: { in: ["CONFIRMED", "PENDING"] },
      startTime: { lt: hostDayEnd },
      endTime: { gt: hostDayStart },
    },
    orderBy: { startTime: "asc" },
  });

  // Generate candidate slots
  const slots: Slot[] = [];
  let cursor = dateMax([hostDayStart, earliest]);

  while (isBefore(addMinutes(cursor, duration), hostDayEnd) || addMinutes(cursor, duration).getTime() === hostDayEnd.getTime()) {
    const slotStart = cursor;
    const slotEnd = addMinutes(cursor, duration);

    // Check for collisions (including buffers)
    const bufferedStart = addMinutes(slotStart, -bufferBefore);
    const bufferedEnd = addMinutes(slotEnd, bufferAfter);
    const hasConflict = existingBookings.some(
      (b) =>
        isBefore(b.startTime, bufferedEnd) &&
        isAfter(b.endTime, bufferedStart)
    );

    if (!hasConflict) {
      slots.push({ start: slotStart, end: slotEnd });
    }

    cursor = addMinutes(cursor, 15); // 15-min increments
  }

  return slots;
}

export async function getAvailableDates(
  eventTypeSlug: string,
  month: string, // YYYY-MM
  timeZone: string
): Promise<string[]> {
  const eventType = await db.eventType.findUnique({
    where: { slug: eventTypeSlug },
  });
  if (!eventType || !eventType.active) return [];

  const hostId = eventType.ownerId;
  if (!hostId) return [];

  const availabilities = await db.availability.findMany({
    where: { userId: hostId },
  });

  const availableDaysOfWeek = new Set(availabilities.map((a) => a.dayOfWeek));

  const [year, mo] = month.split("-").map(Number);
  const firstDay = new Date(year, mo - 1, 1);
  const lastDay = new Date(year, mo, 0);
  const maxDate = addDays(new Date(), eventType.maxDaysAhead);

  const dates: string[] = [];
  let day = firstDay;
  while (day <= lastDay) {
    if (
      availableDaysOfWeek.has(getDay(day)) &&
      isAfter(endOfDay(day), new Date()) &&
      isBefore(day, maxDate)
    ) {
      dates.push(format(day, "yyyy-MM-dd"));
    }
    day = addDays(day, 1);
  }

  return dates;
}
