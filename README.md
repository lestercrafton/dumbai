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
app/
  layout.tsx              Root layout with Ovanova metadata
  page.tsx                Public landing page
  globals.css             Tailwind + brand CSS variables
  admin/                  Admin dashboard (event types, bookings, availability, teams)
  api/auth/               NextAuth route handler
  api/slots/              Available dates & time slots API
  api/bookings/           Booking creation API
  book/                   Public booking page
    [slug]/               Per-event-type booking flow with calendar widget
components/
  brand/                  Logo and brand primitives
  layout/                 SiteHeader / SiteFooter
  admin/                  AdminSidebar
  booking/                BookingWidget (calendar + time picker + form)
lib/
  branding.ts             Single source of truth for name, colors, URLs, copy
  auth.ts                 NextAuth config (Google + credentials)
  auth-helpers.ts         requireAuth / requireAdmin
  availability.ts         Slot computation engine
  db.ts                   Prisma client singleton
  email.ts                Branded HTML email templates
  utils.ts                cn() helper
prisma/
  schema.prisma           Full data model (User, EventType, Booking, Team, etc.)
  seed.ts                 Seeds admin, event types, teams, availability
public/brand/             Favicon + brand assets
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

1. Branding foundation — config, theme, landing page, layout
2. Data model & auth — Prisma schema + NextAuth (Google + credentials)
3. Admin dashboard — event types, availability, bookings, teams
4. Public booking flow — calendar widget, time slots, custom questions
5. Branded emails — confirmation, reminder, cancellation, host notification
6. Deployment guide — see DEPLOY.md
7. Google Calendar + Outlook + Meet/Zoom integrations (wired in auth, needs API calls)
8. Advanced — Stripe payments, approvals, CRM webhooks

## License

Internal Ovanova project. © Ovanova Energy, Inc.
