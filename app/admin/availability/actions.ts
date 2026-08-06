"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveAvailability(formData: FormData) {
  const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No admin user found");

  const timeZone = formData.get("timeZone") as string;
  await db.user.update({ where: { id: admin.id }, data: { timeZone } });
  await db.availability.deleteMany({ where: { userId: admin.id } });

  for (let day = 0; day <= 6; day++) {
    const enabled = formData.get(`enabled_${day}`) === "on";
    if (!enabled) continue;
    const startTime = formData.get(`start_${day}`) as string;
    const endTime = formData.get(`end_${day}`) as string;
    if (startTime && endTime) {
      await db.availability.create({ data: { userId: admin.id, dayOfWeek: day, startTime, endTime } });
    }
  }

  revalidatePath("/admin/availability");
}
