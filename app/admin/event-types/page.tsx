import Link from "next/link";
import { db } from "@/lib/db";
import { brand } from "@/lib/branding";

export const metadata = { title: "Event Types" };

export default async function EventTypesPage() {
  const eventTypes = await db.eventType.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { bookings: true, questions: true } } },
  });

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Event Types</h1>
          <p className="mt-1 text-sm text-ink-muted">Manage the meeting types available on your booking page.</p>
        </div>
        <Link href="/admin/event-types/new" className="btn-primary">+ New event type</Link>
      </div>
      <div className="space-y-3">
        {eventTypes.length === 0 ? (
          <div className="card text-center text-ink-muted">
            <p>No event types yet. Run <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">npm run db:seed</code> to create the defaults, or add one manually.</p>
          </div>
        ) : (
          eventTypes.map((et) => (
            <div key={et.id} className="card flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-1.5 rounded-full" style={{ backgroundColor: et.category === "sales" ? brand.colors.accent : et.category === "engineering" ? brand.colors.primary : brand.colors.secondary }} />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{et.title}</h3>
                    {!et.active && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">Inactive</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">{et.durationMinutes} min · {et.locationType.replace("_", " ").toLowerCase()} · {et._count.bookings} bookings · {et._count.questions} questions</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/book/${et.slug}`} className="text-sm text-ink-muted hover:text-brand" target="_blank">Preview</Link>
                <Link href={`/admin/event-types/${et.id}`} className="btn-secondary text-xs">Edit</Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
