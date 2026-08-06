import Link from "next/link";
import { db } from "@/lib/db";
import { brand } from "@/lib/branding";
import { format } from "date-fns";

async function getStats() {
  const [totalBookings, upcomingBookings, eventTypes, teams] =
    await Promise.all([
      db.booking.count(),
      db.booking.count({
        where: { startTime: { gte: new Date() }, status: "CONFIRMED" },
      }),
      db.eventType.count({ where: { active: true } }),
      db.team.count(),
    ]);

  const recentBookings = await db.booking.findMany({
    where: { status: "CONFIRMED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { eventType: true },
  });

  return { totalBookings, upcomingBookings, eventTypes, teams, recentBookings };
}

export default async function AdminDashboard() {
  const stats = await getStats();

  const statCards = [
    { label: "Upcoming", value: stats.upcomingBookings, href: "/admin/bookings" },
    { label: "Total bookings", value: stats.totalBookings, href: "/admin/bookings" },
    { label: "Event types", value: stats.eventTypes, href: "/admin/event-types" },
    { label: "Teams", value: stats.teams, href: "/admin/teams" },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {brand.productName} — overview
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Link key={s.label} href={s.href} className="card transition hover:-translate-y-0.5 hover:border-brand">
            <p className="text-sm text-ink-muted">{s.label}</p>
            <p className="mt-1 text-3xl font-semibold text-brand">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">Recent bookings</h2>
        {stats.recentBookings.length === 0 ? (
          <div className="card text-center text-ink-muted">
            <p>No bookings yet. Share your booking page to get started!</p>
            <p className="mt-2 text-sm font-medium text-brand">{brand.appUrl}/book</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentBookings.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.guestName}</p>
                      <p className="text-xs text-ink-muted">{b.guestEmail}</p>
                    </td>
                    <td className="px-4 py-3">{b.eventType.title}</td>
                    <td className="px-4 py-3">{format(b.startTime, "MMM d, yyyy 'at' h:mm a")}</td>
                    <td className="px-4 py-3">
                      <span className={b.status === "CONFIRMED" ? "rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand" : "rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning"}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
