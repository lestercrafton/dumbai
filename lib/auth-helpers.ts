import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/admin/login");
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if ((session.user as any).role !== "ADMIN") redirect("/admin");
  return session;
}

export async function getAuth() {
  return getServerSession(authOptions);
}
