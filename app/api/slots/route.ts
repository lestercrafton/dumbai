import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots, getAvailableDates } from "@/lib/availability";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const slug = params.get("slug");
  const date = params.get("date");
  const month = params.get("month");
  const tz = params.get("tz") ?? "America/Los_Angeles";

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  if (month) {
    const dates = await getAvailableDates(slug, month, tz);
    return NextResponse.json({ dates });
  }

  if (date) {
    const slots = await getAvailableSlots({ eventTypeSlug: slug, dateStr: date, timeZone: tz });
    return NextResponse.json({
      slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    });
  }

  return NextResponse.json({ error: "date or month parameter required" }, { status: 400 });
}
