import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { brand } from "@/lib/branding";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { BookingWidget } from "@/components/booking/BookingWidget";

interface Props { params: { slug: string }; }

export async function generateMetadata({ params }: Props) {
  const et = await db.eventType.findUnique({ where: { slug: params.slug } });
  if (!et) return {};
  return { title: et.title, description: et.description ?? `Book a ${et.title} with ${brand.name}` };
}

export default async function BookEventPage({ params }: Props) {
  const eventType = await db.eventType.findUnique({
    where: { slug: params.slug },
    include: { questions: { orderBy: { sortOrder: "asc" } }, owner: { select: { name: true, image: true } } },
  });
  if (!eventType || !eventType.active) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-12">
          <div className="mb-8 text-center">
            <span className="eyebrow">{brand.name}</span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{eventType.title}</h1>
            {eventType.description && <p className="mx-auto mt-3 max-w-lg text-ink-muted">{eventType.description}</p>}
            <div className="mt-4 flex items-center justify-center gap-4 text-sm text-ink-muted">
              <span>{eventType.durationMinutes} minutes</span>
              <span>·</span>
              <span>{eventType.locationType.replace("_", " ").toLowerCase()}</span>
              {eventType.owner?.name && (<><span>·</span><span>with {eventType.owner.name}</span></>)}
            </div>
          </div>
          <BookingWidget eventType={{ id: eventType.id, slug: eventType.slug, title: eventType.title, durationMinutes: eventType.durationMinutes, questions: eventType.questions.map((q) => ({ id: q.id, label: q.label, type: q.type, required: q.required, options: q.options ? JSON.parse(q.options) : null })) }} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
