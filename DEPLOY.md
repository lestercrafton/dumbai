# Deploying Ovanova Scheduling

This guide assumes zero DevOps experience. You'll need:
- A computer with a browser
- A credit card (some services have free tiers, but may ask for one)
- About 30 minutes

---

## Option A: Vercel + Neon (Recommended — easiest)

### Step 1: Get a Postgres database (Neon — free tier)

1. Go to **neon.tech** and sign up (use your Google account).
2. Click **"New Project"** → name it `ovanova-scheduling`.
3. Once created, Neon shows you a **connection string** that looks like:
   ```
   postgresql://user:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Copy this connection string.** You'll paste it into Vercel in Step 3.

> Before deploying, update `prisma/schema.prisma`: change `provider = "sqlite"` to `provider = "postgresql"`.

### Step 2: Push your code to GitHub

If you haven't already:
1. Go to **github.com** → click **"+"** → **"New repository"**.
2. Name it `ovanova-scheduling`, make it private, click **"Create"**.
3. Follow GitHub's instructions to push your existing code.

### Step 3: Deploy on Vercel (free tier)

1. Go to **vercel.com** and sign up with your GitHub account.
2. Click **"Add New" → "Project"**.
3. Import your `ovanova-scheduling` repository.
4. In **"Environment Variables"**, add each of these (one per row):

| Variable Name     | What to put                                      |
|-------------------|--------------------------------------------------|
| `DATABASE_URL`    | The Neon connection string from Step 1            |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` in terminal, paste result |
| `NEXTAUTH_URL`    | Your Vercel URL (e.g. `https://ovanova-scheduling.vercel.app`) |
| `ADMIN_EMAIL`     | `lester@ovanova.co`                               |
| `ADMIN_PASSWORD`  | A strong password (you'll use this to log in)     |

5. Click **"Deploy"**. Vercel builds and hosts your app automatically.
6. After deploy, go to the **Vercel dashboard → your project → Settings → Domains** and add your custom domain (`scheduling.ovanova.co`). Vercel will give you DNS records to add.

### Step 4: Initialize the database

After your first deploy, you need to set up the database tables:

1. Install the project locally: `npm install`
2. Set `DATABASE_URL` in your local `.env` to the Neon connection string.
3. Run: `npx prisma db push` (creates tables)
4. Run: `npm run db:seed` (creates your admin user, event types, teams)

### Step 5: Set up Google OAuth (for calendar sync)

1. Go to **console.cloud.google.com**.
2. Create a new project called "Ovanova Scheduling".
3. Go to **APIs & Services → OAuth consent screen**:
   - Choose "External", fill in app name ("Ovanova Scheduling").
   - Add scopes: `email`, `profile`, `openid`, plus `Google Calendar API`.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**:
   - Application type: "Web application"
   - Authorized redirect URI: `https://scheduling.ovanova.co/api/auth/callback/google`
5. Copy the **Client ID** and **Client Secret**.
6. Add them to Vercel's environment variables:
   - `GOOGLE_CLIENT_ID` = the Client ID
   - `GOOGLE_CLIENT_SECRET` = the Client Secret
7. Redeploy on Vercel (it picks up new env vars on next deploy).

---

## Option B: Railway (also easy)

1. Go to **railway.app**, sign up with GitHub.
2. Click **"New Project" → "Deploy from GitHub Repo"**.
3. Select your repo. Railway auto-detects Next.js.
4. Click **"Add Plugin" → "PostgreSQL"** — Railway gives you a free Postgres instance.
5. In **Variables**, add the same env vars as Option A above. Use the Railway-provided `DATABASE_URL`.
6. Railway deploys automatically and gives you a URL.
7. Add a custom domain in Settings.

---

## Option C: Docker (self-hosted)

If you have a VPS (DigitalOcean, Hetzner, AWS EC2, etc.):

```bash
# On your server:
git clone <your-repo-url> ovanova-scheduling
cd ovanova-scheduling

# Create .env from the example
cp .env.example .env
# Edit .env with your real values (DATABASE_URL, secrets, etc.)

# Build and run
docker build -t ovanova-scheduling .
docker run -d -p 3000:3000 --env-file .env ovanova-scheduling
```

You'll need to set up Postgres separately (or use a managed service like Neon or Supabase) and point a reverse proxy (Nginx/Caddy) at port 3000.

---

## After deploying

1. **Log in** at `https://scheduling.ovanova.co/admin/login` with your admin credentials.
2. **Check event types** at `/admin/event-types` — verify the 4 defaults are there.
3. **Set availability** at `/admin/availability` — confirm your working hours.
4. **Test the booking flow** — visit `/book`, pick a meeting type, book a test meeting.
5. **Share your booking link**: `https://scheduling.ovanova.co/book`

## Setting up email (optional but recommended)

1. Sign up at **resend.com** (free tier: 100 emails/day).
2. Verify your domain (`ovanova.co`) in Resend's dashboard.
3. Get your API key and add `RESEND_API_KEY` to your environment variables.
4. Redeploy — confirmation/reminder/cancellation emails will now send automatically.

---

## Quick reference: all environment variables

| Variable                | Required? | Description                              |
|-------------------------|-----------|------------------------------------------|
| `DATABASE_URL`          | Yes       | Postgres connection string               |
| `NEXTAUTH_SECRET`       | Yes       | Random 32-byte secret for sessions       |
| `NEXTAUTH_URL`          | Yes       | Full URL of your deployed app            |
| `NEXT_PUBLIC_APP_URL`   | Yes       | Same as NEXTAUTH_URL (for client-side)   |
| `ADMIN_EMAIL`           | Yes       | Your login email                         |
| `ADMIN_PASSWORD`        | Yes       | Your login password                      |
| `GOOGLE_CLIENT_ID`      | For OAuth | Google OAuth client ID                   |
| `GOOGLE_CLIENT_SECRET`  | For OAuth | Google OAuth client secret               |
| `MICROSOFT_CLIENT_ID`   | Optional  | For Outlook calendar sync                |
| `MICROSOFT_CLIENT_SECRET`| Optional | For Outlook calendar sync                |
| `RESEND_API_KEY`        | Optional  | For sending emails                       |
| `STRIPE_SECRET_KEY`     | Optional  | For paid consultations                   |
| `STRIPE_WEBHOOK_SECRET` | Optional  | For Stripe webhook verification          |
