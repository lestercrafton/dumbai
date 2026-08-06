import Link from "next/link";
import { db } from "@/lib/db";
import { brand } from "@/lib/branding";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

export const metadata = {
  title: "Book a meeting",
  description: `Schedule time with the ${brand.name} team.`,
};

export default async function BookingPage() {
  const eventTypes = await db.eventType.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <div className="mb-10 text-center">
            <span className="eyebrow">Book a meeting</span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">How can we help?</h1>
            <p className="mx-auto mt-3 max-w-lg text-ink-muted">Choose a meeting type below to find an available time with the {brand.name} team.</p>
          </div>
          {eventTypes.length === 0 ? (
            <div className="card text-center text-ink-muted">No event types available right now. Please check back soon.</div>
          ) : (
            <div className="space-y-3">
              {eventTypes.map((et) => (
                <Link key={et.slug} href={`/book/${et.slug}`} className="card group flex items-center justify-between transition hover:-translate-y-0.5 hover:border-brand">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-1.5 rounded-full" style={{ backgroundColor: et.category === "sales" ? brand.colors.accent : et.category === "engineering" ? brand.colors.primary : brand.colors.secondary }} />
                    <div>
                      <h2 className="text-lg font-semibold group-hover:text-brand">{et.title}</h2>
                      <p className="mt-0.5 text-sm text-ink-muted">{et.description}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-ink-muted">{et.durationMinutes} min</p>
                    <p className="mt-1 text-sm font-medium text-brand opacity-0 transition group-hover:opacity-100">Select →</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
