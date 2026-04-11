/**
 * Ovanova Scheduling — Central Branding Module
 * ---------------------------------------------
 * Every user-visible string, color, URL, and metadata value related to
 * branding lives here. Importing components / emails / metadata should
 * never hardcode "Ovanova", colors, or URLs — always read from this file.
 *
 * To rebrand or update any label, edit this file ONLY.
 */

export const brand = {
  /** Legal + display name */
  name: "Ovanova",
  /** Product name shown in the UI */
  productName: "Ovanova Scheduling",
  /** Short tagline used on landing + emails */
  tagline: "Schedule with Ovanova — resilient energy, reliable meetings.",
  /** Longer marketing description */
  description:
    "Ovanova designs and deploys microgrids and resilient energy systems. Book a consultation, site assessment, or partner meeting with our team in seconds.",
  /** Company website (public marketing site) */
  websiteUrl: "https://ovanova.co",
  /** Where this scheduling app lives */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://scheduling.ovanova.co",
  /** Support / contact email shown in footers and emails */
  supportEmail: "scheduling@ovanova.co",
  /** Reply-to address on outbound email */
  fromEmail: "Ovanova Scheduling <scheduling@ovanova.co>",
  /** Default time zone for the company (fallback; users can override) */
  defaultTimeZone: "America/Los_Angeles",
  /** Copyright / legal holder */
  legalName: "Ovanova Energy, Inc.",

  /** Brand color palette — also exposed to Tailwind via tailwind.config.ts */
  colors: {
    /** Primary deep energy green — headers, CTAs, accents */
    primary: "#006837",
    primaryDark: "#004d29",
    primaryLight: "#1f8a4c",
    /** Secondary: steel / trust blue */
    secondary: "#0b3d5c",
    /** Accent: solar amber — highlights, badges */
    accent: "#f5a524",
    /** Neutral slate background */
    surface: "#f7f9f8",
    surfaceMuted: "#eef2ef",
    /** Text */
    ink: "#0f1c17",
    inkMuted: "#475a52",
    /** Borders */
    border: "#d8e1dc",
    /** Status */
    success: "#1f8a4c",
    warning: "#f5a524",
    danger: "#b4321a",
  },

  /** Social / external links shown in footer */
  social: {
    linkedin: "https://www.linkedin.com/company/ovanova",
    website: "https://ovanova.co",
  },

  /** Curated default event types — seeded into the DB on first run */
  defaultEventTypes: [
    {
      slug: "discovery-call",
      title: "30-min Discovery Call",
      durationMinutes: 30,
      description:
        "A quick intro to understand your resilience goals and see if Ovanova is the right fit.",
      category: "sales",
    },
    {
      slug: "site-assessment",
      title: "Site Assessment",
      durationMinutes: 60,
      description:
        "On-site or virtual walkthrough to scope a microgrid or backup power project for your facility.",
      category: "engineering",
    },
    {
      slug: "technical-consultation",
      title: "Technical Consultation",
      durationMinutes: 45,
      description:
        "Deep-dive with an Ovanova engineer on system design, load profiles, and integration specifics.",
      category: "engineering",
    },
    {
      slug: "partner-meeting",
      title: "Partner Meeting",
      durationMinutes: 30,
      description:
        "For vendors, installers, and channel partners working with Ovanova.",
      category: "operations",
    },
  ],
} as const;

export type Brand = typeof brand;
