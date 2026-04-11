# Ovanova Scheduling

A self-hosted, fully branded scheduling platform for **Ovanova** — the
microgrid and resilient energy company. Think "Calendly we actually own",
tailored to how Ovanova books discovery calls, site assessments,
technical consultations, and partner meetings.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Tailwind CSS** — theme driven by `lib/branding.ts`
- **Prisma** + SQLite (dev) / Postgres (prod)
- **NextAuth** — Google + Microsoft OAuth (also powers calendar sync)
- **Resend** + React Email — transactional email

## Project layout

```
app/              Next.js App Router pages
  layout.tsx      Root metadata + fonts (reads lib/branding.ts)
  page.tsx        Public Ovanova landing page
  globals.css     Tailwind + brand CSS variables
components/
  brand/          Logo and brand primitives
  layout/         SiteHeader / SiteFooter
lib/
  branding.ts     Single source of truth for name, colors, URLs, copy
  utils.ts        cn() helper
public/brand/     Favicon + brand assets
```

## Where branding lives

Every user-visible label ("Ovanova"), brand color, URL, and contact
address is read from **`lib/branding.ts`**. To rebrand or change a
color, edit that file — nothing else.

## Getting started (local)

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:3000>.

## Roadmap (phases)

1. ✅ **Branding foundation** — config, theme, landing page, layout
2. 🔜 Data model & auth (Prisma + NextAuth)
3. 🔜 Admin dashboard (event types, availability, bookings)
4. 🔜 Public booking flow with custom questions
5. 🔜 Google Calendar + Outlook + Meet/Zoom integrations
6. 🔜 Branded transactional emails
7. 🔜 Advanced — Stripe payments, approvals, CRM webhooks
8. 🔜 Deployment guide (Vercel + Neon + Resend)

## License

Internal Ovanova project. © Ovanova Energy, Inc.
