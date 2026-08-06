import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { addMinutes, parseISO } from "date-fns";

const bookingSchema = z.object({
  eventTypeSlug: z.string(),
  startTime: z.string().datetime(),
  timeZone: z.string(),
  guestName: z.string().min(1),
  guestEmail: z.string().email(),
  guestNotes: z.string().optional(),
  answers: z.array(z.object({ questionId: z.string(), value: z.string() })).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = bookingSchema.parse(body);

    const eventType = await db.eventType.findUnique({ where: { slug: data.eventTypeSlug } });
    if (!eventType || !eventType.active) {
      return NextResponse.json({ error: "Event type not found or inactive" }, { status: 404 });
    }
    if (!eventType.ownerId) {
      return NextResponse.json({ error: "No host assigned to this event type" }, { status: 400 });
    }

    const start = parseISO(data.startTime);
    const end = addMinutes(start, eventType.durationMinutes);

    const conflict = await db.booking.findFirst({
      where: {
        hostId: eventType.ownerId,
        status: { in: ["CONFIRMED", "PENDING"] },
        startTime: { lt: end },
        endTime: { gt: start },
      },
    });

    if (conflict) {
      return NextResponse.json({ error: "This time slot is no longer available" }, { status: 409 });
    }

    const booking = await db.booking.create({
      data: {
        eventTypeId: eventType.id,
        hostId: eventType.ownerId,
        guestName: data.guestName,
        guestEmail: data.guestEmail,
        guestNotes: data.guestNotes ?? null,
        startTime: start,
        endTime: end,
        timeZone: data.timeZone,
        status: eventType.requiresApproval ? "PENDING" : "CONFIRMED",
        answers: data.answers
          ? { create: data.answers.map((a) => ({ questionId: a.questionId, value: a.value })) }
          : undefined,
      },
      include: { eventType: true, answers: { include: { question: true } } },
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.errors }, { status: 400 });
    }
    console.error("Booking error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
