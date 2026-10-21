# Phone trips (iPhone) + server-side sending

The iPhone app (`../mobile`) detects drives with background location, asks at the end of each drive whether it was
business and which car was used, and uploads the answer to the Vercel API in `tesla-site/`. The API decides what is
reimbursed, emails Sugar (or whoever each person sets as recipient) from that person's own Gmail via the Gmail API,
runs the Friday batch, and keeps a monthly log CSV in a "Mileage logs" folder in that person's own Google Drive.
Anyone with a Google account can sign in; there are no passwords or tokens to hand out.

## Rules
| Trip | Result |
|---|---|
| Business, personal car | Reimbursed: **Send now** emails Sugar immediately; **Batch** goes out Friday 17:00 Central |
| Business, company (business) car | Logged only (Drive log), never emailed |
| Personal | Logged only |

- Miles come from GPS (no odometer). The email lists GPS miles per trip, the IRS rate for each trip date
  ($0.725 Jan–Jun 2026, $0.76 from Jul 1 2026), and attaches a CSV. It does not mention odometer captures.
  The phone counts every mile it records for every car; it never looks at Tesla data. Batches made only of Tesla-tool trips keep the existing odometer email.
- A trip is marked sent as soon as Gmail accepts the message; a per-person lock stops two sends running at once,
  and a sent trip can never be sent or queued again. Resubmitting the same trip from the phone is harmless.

## Sign-in
The app's **Sign in with Google** button opens `/api/phone/auth/start` in a browser sheet. The server runs Google's
authorization-code flow (with PKCE) asking for `openid email profile`, `gmail.send` and `drive.file`, stores the refresh
token encrypted (AES-256-GCM, key from `TOKEN_ENC_KEY` or derived from `SESSION_SECRET`) in Upstash, and returns to the
app (`ovanovamileage://auth`) with a one-time code. The app trades it at `/api/phone/auth/exchange` for a 180-day session
token kept in the iPhone keychain. If Google later rejects the refresh token, the app shows "Sign in with Google again".
If a user doesn't allow Gmail, the server falls back to SMTP (`SMTP_PASS_<NAME>` for that user, else the shared `SMTP_*`).

## API (JSON, `Authorization: Bearer <session token>` except auth/cron)
- `GET /api/phone/auth/start?redirect=ovanovamileage://auth`, `GET /api/phone/auth/callback`, `POST /api/phone/auth/exchange {code}`
- `POST /api/phone/auth/signout {revoke?}`
- `GET /api/phone/me`, `PUT /api/phone/settings {sugar, sugarCc}` (recipient, default sugar@ovanova.co)
- `GET|PUT /api/phone/cars`, `POST|GET /api/phone/trips`, `POST /api/phone/send {ids}`
- `GET /api/phone/cron` (Friday batch; `Authorization: Bearer $CRON_SECRET`)

## One-time setup
1. **Google OAuth client (Web application)** in Google Cloud: authorized redirect URI
   `https://ovanova-mileage-tesla.vercel.app/api/phone/auth/callback` (add `/auth/google/callback` too for the web app).
   Enable the **Gmail API** and **Google Drive API**. On the consent screen add the scopes `gmail.send` and `drive.file`.
2. Vercel env (Production): `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET`. Already set: `SESSION_SECRET`,
   `CRON_SECRET`, Upstash `KV_REST_API_*`. Optional: `TOKEN_ENC_KEY`.
3. While the Google app is in **Testing** mode only listed test users (max 100) can sign in, they see an
   "unverified app" warning, and their sign-in expires after 7 days. Publishing removes those limits but `gmail.send`
   is a sensitive scope, so Google verification is required (privacy policy, homepage, demo video; takes days–weeks).
   For a Google Workspace org, choosing **Internal** avoids all of this but only allows that org's accounts.
4. Deploy. The Friday batch is checked every 5 minutes by `.github/workflows/mileage-poll.yml` and once on Fridays by
   a backup Vercel cron.

## iPhone app build (Expo, free)
1. `cd mobile && npm install && npx eas-cli login` (free Expo account) and `npx eas-cli init` to link the project.
2. `npx eas-cli build -p ios --profile production` – signs with Lester's Apple Developer account (EAS asks for the Apple ID).
3. `npx eas-cli submit -p ios` – uploads to App Store Connect. In TestFlight, add John and Chris as internal testers.
   (Alternative without TestFlight: `--profile preview` with their device UDIDs registered via `eas device:create`.)
4. On each phone: install from TestFlight, open Settings tab → **Sign in with Google** → allow the permissions. Add cars in the Cars tab
   (mark company cars). Turn on Automatic trip tracking and choose **Always** for location.
