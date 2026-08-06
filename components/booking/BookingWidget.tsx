"use client";

import { useState, useEffect } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, parseISO, isBefore, startOfDay } from "date-fns";
import { brand } from "@/lib/branding";

interface Question { id: string; label: string; type: string; required: boolean; options: string[] | null; }
interface Props { eventType: { id: string; slug: string; title: string; durationMinutes: number; questions: Question[]; }; }
type Step = "date" | "time" | "details" | "confirmed";

export function BookingWidget({ eventType }: Props) {
  const [step, setStep] = useState<Step>("date");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestNotes, setGuestNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    const month = format(currentMonth, "yyyy-MM");
    setLoading(true);
    fetch(`/api/slots?slug=${eventType.slug}&month=${month}&tz=${tz}`)
      .then((r) => r.json()).then((data) => setAvailableDates(data.dates ?? [])).finally(() => setLoading(false));
  }, [currentMonth, eventType.slug, tz]);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true); setSlots([]);
    fetch(`/api/slots?slug=${eventType.slug}&date=${selectedDate}&tz=${tz}`)
      .then((r) => r.json()).then((data) => setSlots(data.slots ?? [])).finally(() => setLoading(false));
  }, [selectedDate, eventType.slug, tz]);

  function selectDate(dateStr: string) { setSelectedDate(dateStr); setSelectedSlot(null); setStep("time"); }
  function selectSlot(startIso: string) { setSelectedSlot(startIso); setStep("details"); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true); setError(null);
    const answerPayload = eventType.questions.filter((q) => answers[q.id]).map((q) => ({ questionId: q.id, value: answers[q.id] }));
    try {
      const res = await fetch("/api/bookings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventTypeSlug: eventType.slug, startTime: selectedSlot, timeZone: tz, guestName, guestEmail, guestNotes: guestNotes || undefined, answers: answerPayload.length > 0 ? answerPayload : undefined }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? "Something went wrong"); setSubmitting(false); return; }
      setStep("confirmed");
    } catch { setError("Network error — please try again"); }
    setSubmitting(false);
  }

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  if (step === "confirmed") {
    const dt = selectedSlot ? parseISO(selectedSlot) : new Date();
    return (
      <div className="card mx-auto max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand/10">
          <svg className="h-8 w-8 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-semibold">You're booked!</h2>
        <p className="mt-2 text-ink-muted">{eventType.title} on <strong>{format(dt, "EEEE, MMMM d, yyyy")}</strong> at <strong>{format(dt, "h:mm a")}</strong></p>
        <p className="mt-1 text-sm text-ink-muted">{tz}</p>
        <p className="mt-4 text-sm text-ink-muted">A confirmation email will be sent to <strong>{guestEmail}</strong>.</p>
        <div className="mt-6"><a href="/book" className="btn-secondary">Book another meeting</a></div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-surface-muted" disabled={isBefore(endOfMonth(subMonths(currentMonth, 1)), new Date())}>‹</button>
          <h3 className="text-sm font-semibold">{format(currentMonth, "MMMM yyyy")}</h3>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="rounded-lg px-2 py-1 text-ink-muted hover:bg-surface-muted">›</button>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const isAvailable = availableDates.includes(dateStr);
            const isSelected = selectedDate === dateStr;
            const isPast = isBefore(day, startOfDay(new Date()));
            return (
              <button key={dateStr} onClick={() => isAvailable && selectDate(dateStr)} disabled={!isAvailable || isPast}
                className={`aspect-square rounded-lg text-sm font-medium transition ${isSelected ? "bg-brand text-white" : isAvailable && !isPast ? "hover:bg-brand/10 hover:text-brand" : "text-ink-muted/40 cursor-not-allowed"}`}>
                {format(day, "d")}
              </button>
            );
          })}
        </div>
        {selectedDate && (step === "time" || step === "details") && (
          <div className="mt-6 border-t border-border pt-4">
            <h4 className="mb-3 text-sm font-semibold text-ink-muted">Available times for {format(parseISO(selectedDate), "EEEE, MMM d")}</h4>
            {loading ? <p className="text-sm text-ink-muted">Loading…</p> : slots.length === 0 ? <p className="text-sm text-ink-muted">No available slots on this day.</p> : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => {
                  const isSelected = selectedSlot === slot.start;
                  return <button key={slot.start} onClick={() => selectSlot(slot.start)} className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${isSelected ? "border-brand bg-brand text-white" : "border-border hover:border-brand hover:text-brand"}`}>{format(parseISO(slot.start), "h:mm a")}</button>;
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {step === "details" && selectedSlot && (
        <form onSubmit={handleSubmit} className="card self-start space-y-4">
          <h3 className="font-semibold">Your details</h3>
          <div><label className="block text-sm font-medium text-ink-muted">Name *</label><input required value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" /></div>
          <div><label className="block text-sm font-medium text-ink-muted">Email *</label><input type="email" required value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" /></div>
          {eventType.questions.map((q) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-ink-muted">{q.label} {q.required && "*"}</label>
              {q.type === "SELECT" && q.options ? (
                <select required={q.required} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring">
                  <option value="">Select…</option>{q.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : q.type === "TEXTAREA" ? (
                <textarea required={q.required} rows={2} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
              ) : (
                <input type={q.type === "EMAIL" ? "email" : q.type === "PHONE" ? "tel" : "text"} required={q.required} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
              )}
            </div>
          ))}
          <div><label className="block text-sm font-medium text-ink-muted">Notes (optional)</label><textarea rows={2} value={guestNotes} onChange={(e) => setGuestNotes(e.target.value)} placeholder="Anything else we should know…" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" /></div>
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full justify-center">{submitting ? "Booking…" : "Confirm booking"}</button>
          <p className="text-center text-xs text-ink-muted">By booking, you agree to share your details with {brand.name}.</p>
        </form>
      )}
    </div>
  );
}
