import { db } from "@/lib/db";
import { saveAvailability } from "./actions";

export const metadata = { title: "Availability" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AvailabilityPage() {
  const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  const availability = admin ? await db.availability.findMany({ where: { userId: admin.id }, orderBy: { dayOfWeek: "asc" } }) : [];
  const byDay = Object.fromEntries(availability.map((a) => [a.dayOfWeek, a]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <p className="mt-1 text-sm text-ink-muted">Set your weekly working hours. Guests can only book during these windows.</p>
      </div>
      <form action={saveAvailability} className="card max-w-2xl">
        <div className="space-y-4">
          {DAYS.map((day, i) => {
            const slot = byDay[i];
            return (
              <div key={i} className="flex items-center gap-4 border-b border-border pb-4 last:border-0 last:pb-0">
                <label className="flex w-32 items-center gap-2 text-sm">
                  <input type="checkbox" name={`enabled_${i}`} defaultChecked={!!slot} className="h-4 w-4 rounded border-border accent-brand" />
                  {day}
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <input name={`start_${i}`} type="time" defaultValue={slot?.startTime ?? "09:00"} className="rounded-lg border border-border bg-surface px-3 py-1.5 outline-none focus:border-brand focus:shadow-ring" />
                  <span className="text-ink-muted">to</span>
                  <input name={`end_${i}`} type="time" defaultValue={slot?.endTime ?? "17:00"} className="rounded-lg border border-border bg-surface px-3 py-1.5 outline-none focus:border-brand focus:shadow-ring" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6">
          <label className="block text-sm font-medium text-ink-muted">Time zone</label>
          <input name="timeZone" defaultValue={admin?.timeZone ?? "America/Los_Angeles"} className="mt-1 w-full max-w-xs rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
        </div>
        <div className="mt-6 flex justify-end"><button type="submit" className="btn-primary">Save availability</button></div>
      </form>
    </div>
  );
}
