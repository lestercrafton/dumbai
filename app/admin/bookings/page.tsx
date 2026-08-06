import { db } from "@/lib/db";
import { format, isPast } from "date-fns";

export const metadata = { title: "Bookings" };

export default async function BookingsPage() {
  const bookings = await db.booking.findMany({
    orderBy: { startTime: "desc" },
    include: { eventType: true, answers: { include: { question: true } } },
  });

  const upcoming = bookings.filter((b) => !isPast(b.startTime) && b.status === "CONFIRMED");
  const past = bookings.filter((b) => isPast(b.startTime) || b.status !== "CONFIRMED");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="mt-1 text-sm text-ink-muted">{upcoming.length} upcoming · {past.length} past / cancelled</p>
      </div>
      {bookings.length === 0 ? (
        <div className="card text-center text-ink-muted">No bookings yet. Share your booking page to get started!</div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">Upcoming</h2>
              <div className="space-y-3">{upcoming.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-muted">Past / Cancelled</h2>
              <div className="space-y-3">{past.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function BookingCard({ booking }: { booking: any }) {
  const statusColors: Record<string, string> = {
    CONFIRMED: "bg-brand/10 text-brand",
    PENDING: "bg-warning/10 text-warning",
    CANCELLED: "bg-danger/10 text-danger",
    COMPLETED: "bg-surface-muted text-ink-muted",
  };
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{booking.guestName}</h3>
          <p className="text-sm text-ink-muted">{booking.guestEmail}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[booking.status] ?? statusColors.CONFIRMED}`}>{booking.status}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
        <span>{booking.eventType.title}</span>
        <span>{format(booking.startTime, "MMM d, yyyy")} at {format(booking.startTime, "h:mm a")} – {format(booking.endTime, "h:mm a")}</span>
        <span>{booking.timeZone}</span>
      </div>
      {booking.guestNotes && <p className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-muted">{booking.guestNotes}</p>}
      {booking.answers.length > 0 && (
        <div className="mt-3 space-y-1">
          {booking.answers.map((a: any, i: number) => (
            <p key={i} className="text-sm"><span className="text-ink-muted">{a.question.label}:</span> {a.value}</p>
          ))}
        </div>
      )}
    </div>
  );
}
