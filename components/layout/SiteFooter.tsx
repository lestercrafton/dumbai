import { brand } from "@/lib/branding";
import { Logo } from "@/components/brand/Logo";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/70 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-md text-sm text-ink-muted">
            {brand.description}
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-ink-muted md:items-end">
          <a href={brand.websiteUrl} className="hover:text-brand">
            {brand.websiteUrl.replace("https://", "")}
          </a>
          <a href={`mailto:${brand.supportEmail}`} className="hover:text-brand">
            {brand.supportEmail}
          </a>
          <p className="text-xs">
            © {year} {brand.legalName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
