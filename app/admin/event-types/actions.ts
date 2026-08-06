"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const eventTypeSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  durationMinutes: z.coerce.number().min(5).max(480),
  category: z.string().optional(),
  locationType: z.string(),
  bufferBefore: z.coerce.number().min(0),
  bufferAfter: z.coerce.number().min(0),
  minNoticeMinutes: z.coerce.number().min(0),
  maxDaysAhead: z.coerce.number().min(1).max(365),
  active: z.string().optional().transform((v) => v === "on"),
  requiresApproval: z.string().optional().transform((v) => v === "on"),
});

export async function createEventType(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const data = eventTypeSchema.parse(raw);
  const owner = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!owner) throw new Error("No admin user found — run db:seed first");
  await db.eventType.create({ data: { ...data, ownerId: owner.id } });
  revalidatePath("/admin/event-types");
  redirect("/admin/event-types");
}

export async function updateEventType(id: string, formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const data = eventTypeSchema.parse(raw);
  await db.eventType.update({ where: { id }, data });
  revalidatePath("/admin/event-types");
  redirect("/admin/event-types");
}

export async function deleteEventType(id: string) {
  await db.eventType.delete({ where: { id } });
  revalidatePath("/admin/event-types");
  redirect("/admin/event-types");
}

export async function toggleEventType(id: string) {
  const et = await db.eventType.findUnique({ where: { id } });
  if (!et) return;
  await db.eventType.update({ where: { id }, data: { active: !et.active } });
  revalidatePath("/admin/event-types");
}
