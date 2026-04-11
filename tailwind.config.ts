import type { Config } from "tailwindcss";
import { brand } from "./lib/branding";

/**
 * Tailwind theme is driven by lib/branding.ts so that changing a brand
 * color in one place updates the entire UI.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./emails/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: brand.colors.primary,
          dark: brand.colors.primaryDark,
          light: brand.colors.primaryLight,
          secondary: brand.colors.secondary,
          accent: brand.colors.accent,
        },
        surface: {
          DEFAULT: brand.colors.surface,
          muted: brand.colors.surfaceMuted,
        },
        ink: {
          DEFAULT: brand.colors.ink,
          muted: brand.colors.inkMuted,
        },
        border: brand.colors.border,
        success: brand.colors.success,
        warning: brand.colors.warning,
        danger: brand.colors.danger,
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Inter",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 28, 23, 0.04), 0 8px 24px rgba(15, 28, 23, 0.06)",
        ring: `0 0 0 4px ${brand.colors.primary}22`,
      },
      borderRadius: {
        xl: "0.9rem",
        "2xl": "1.25rem",
      },
      backgroundImage: {
        "brand-gradient": `linear-gradient(135deg, ${brand.colors.primaryDark} 0%, ${brand.colors.primary} 55%, ${brand.colors.primaryLight} 100%)`,
        "hero-grid":
          "radial-gradient(circle at 1px 1px, rgba(15,28,23,0.08) 1px, transparent 0)",
      },
    },
  },
  plugins: [],
};

export default config;
