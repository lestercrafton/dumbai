import { brand } from "@/lib/branding";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** Show just the mark (no wordmark) */
  markOnly?: boolean;
  /** Use white variant for dark backgrounds */
  inverted?: boolean;
  className?: string;
}

/**
 * Ovanova wordmark + energy-ring mark.
 *
 * The mark is an intentionally simple SVG so it renders crisply in emails
 * and at favicon size. Replace the <path> below with the real Ovanova
 * logo artwork when it's available — everything else in the app reads
 * the brand name/colors from lib/branding.ts, so no other edits needed.
 */
export function Logo({ markOnly = false, inverted = false, className }: LogoProps) {
  const strokeColor = inverted ? "#ffffff" : brand.colors.primary;
  const textColor = inverted ? "text-white" : "text-ink";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 40 40"
        width="32"
        height="32"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Outer resilience ring */}
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
        />
        {/* Inner energy bolt */}
        <path
          d="M22 9 L12 22 L19 22 L17 31 L28 17 L21 17 Z"
          fill={strokeColor}
        />
      </svg>
      {!markOnly && (
        <span className={cn("text-lg font-semibold tracking-tight", textColor)}>
          {brand.name}
          <span className="ml-1 text-ink-muted font-normal">Scheduling</span>
        </span>
      )}
    </div>
  );
}
