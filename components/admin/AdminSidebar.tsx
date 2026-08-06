"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: "◉" },
  { href: "/admin/event-types", label: "Event Types", icon: "▦" },
  { href: "/admin/bookings", label: "Bookings", icon: "▤" },
  { href: "/admin/availability", label: "Availability", icon: "◷" },
  { href: "/admin/teams", label: "Teams", icon: "◎" },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-white">
      <div className="border-b border-border px-5 py-4"><Link href="/admin"><Logo /></Link></div>
      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active ? "bg-brand/10 text-brand" : "text-ink-muted hover:bg-surface-muted hover:text-ink")}>
                  <span className="text-base">{item.icon}</span>{item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border px-5 py-4">
        <Link href="/book" className="block text-sm text-ink-muted hover:text-brand">View booking page →</Link>
        <Link href="/api/auth/signout" className="mt-2 block text-sm text-ink-muted hover:text-danger">Sign out</Link>
      </div>
    </aside>
  );
}
