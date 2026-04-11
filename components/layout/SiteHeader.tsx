import Link from "next/link";
import { brand } from "@/lib/branding";
import { Logo } from "@/components/brand/Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" aria-label={`${brand.productName} home`}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium text-ink-muted md:flex">
          <a href={brand.websiteUrl} className="hover:text-brand">
            {brand.name}.co
          </a>
          <Link href="/book" className="hover:text-brand">
            Book a meeting
          </Link>
          <Link href="/admin" className="hover:text-brand">
            Team sign in
          </Link>
        </nav>
        <Link href="/book" className="btn-primary">
          Book now
        </Link>
      </div>
    </header>
  );
}
