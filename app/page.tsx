import Link from "next/link";
import { brand } from "@/lib/branding";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

const trustBullets = [
  "Google Calendar & Outlook sync",
  "Automatic Google Meet & Zoom links",
  "Round-robin for sales, engineering & ops",
  "Branded confirmations, reminders & follow-ups",
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-hero-grid [background-size:22px_22px] opacity-60" />
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <div className="max-w-3xl">
              <span className="eyebrow">{brand.productName}</span>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink md:text-6xl">
                Book time with the {brand.name} team.
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-ink-muted md:text-xl">
                {brand.tagline} From discovery calls to on-site assessments,
                schedule a meeting with the engineers and project leads
                building resilient energy systems.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/book" className="btn-primary">
                  Choose a meeting type
                </Link>
                <a href={brand.websiteUrl} className="btn-secondary">
                  Visit {brand.name}.co
                </a>
              </div>
              <ul className="mt-10 grid max-w-2xl gap-3 text-sm text-ink-muted sm:grid-cols-2">
                {trustBullets.map((b) => (
                  <li key={b} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1 inline-block h-2 w-2 rounded-full bg-brand"
                    />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Event types preview */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <span className="eyebrow">Meeting types</span>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                Pick the conversation that fits.
              </h2>
            </div>
            <Link href="/book" className="hidden text-sm font-medium text-brand hover:underline md:block">
              See all →
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {brand.defaultEventTypes.map((et) => (
              <Link
                key={et.slug}
                href={`/book/${et.slug}`}
                className="card group transition hover:-translate-y-0.5 hover:border-brand"
              >
                <div className="flex items-center justify-between">
                  <span className="eyebrow">{et.category}</span>
                  <span className="text-xs font-semibold text-ink-muted">
                    {et.durationMinutes} min
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-ink group-hover:text-brand">
                  {et.title}
                </h3>
                <p className="mt-2 text-sm text-ink-muted">{et.description}</p>
                <p className="mt-4 text-sm font-medium text-brand opacity-0 transition group-hover:opacity-100">
                  Book this →
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
