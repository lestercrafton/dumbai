# Phone trips (iPhone) + server-side sending

The iPhone app (`../mobile`) detects drives with background location, asks at the end of each drive whether it was
business and which car was used, and uploads the answer to the Vercel API in `tesla-site/`. The API decides what is
reimbursed, emails Sugar from each person's own Gmail, runs the Friday batch, and keeps a monthly log in Google Drive.

## Rules
| Trip | Result |
|---|---|
| Business, personal car | Reimbursed: **Send now** emails Sugar immediately; **Batch** goes out Friday 17:00 Central |
| Business, company (business) car | Logged only (Drive log), never emailed |
| Personal | Logged only |
| Tesla picked as the car, or the trip overlaps a Tesla trip by time (±5 min) | Marked *superseded* and kept for audit; the Tesla log is the record, so miles are never counted twice. A Tesla trip that arrives later also supersedes an overlapping phone trip that hasn't been sent yet. |

- Miles come from GPS (no odometer). The email lists GPS miles per trip, the IRS rate for each trip date
  ($0.725 Jan–Jun 2026, $0.76 from Jul 1 2026), and attaches a CSV. It does not mention odometer captures.
  Batches made only of Tesla trips keep the existing odometer email.
- A trip is marked sent as soon as Gmail accepts the message; a per-person lock stops two sends running at once,
  and a sent trip can never be sent or queued again. Resubmitting the same trip from the phone is harmless.

## API (all JSON, `Authorization: Bearer <device token>`)
- `GET /api/phone/me` – who am I, Sugar address, next batch time, whether email/Drive are set up
- `GET|PUT /api/phone/cars` – car list `{id, name, model, vin, ownership: personal|business, isTesla}`
- `POST /api/phone/trips` – `{trips:[{clientId, startTime, endTime, miles, startLoc, endLoc, carId, category, action: send|batch|log, purpose}]}`
- `GET /api/phone/trips?since=ISO` – trips with server status
- `POST /api/phone/send` – `{ids:[...]}` send now
- `GET /api/phone/cron` – Friday batch for everyone (Vercel cron, `Authorization: Bearer $CRON_SECRET`)

## One-time setup (Vercel project `ovanova-mileage-tesla`)
1. **Storage (free):** Vercel → Storage → Marketplace → Upstash Redis (free) → connect to this project.
   This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. **Secrets** (Settings → Environment Variables, Production):
   - `SESSION_SECRET` – long random string (`openssl rand -hex 32`). Signs device tokens.
   - `CRON_SECRET` – long random string. Vercel sends it to the cron automatically.
   - `SMTP_PASS_LESTER`, `SMTP_PASS_JOHN`, `SMTP_PASS_C` – each person's Gmail app password
     (myaccount.google.com/apppasswords, needs 2-Step Verification). The name is `SMTP_PASS_` + the part of the
     address before `@`, upper-case. Mail is sent via smtp.gmail.com:587 as that person.
   - Drive log: `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `DRIVE_FOLDER_ID` (below).
3. **Drive folder:** Google Cloud console → IAM → Service accounts → create `mileage-log`, then Keys → Add key → JSON.
   Copy `client_email` to `GOOGLE_SA_EMAIL` and `private_key` to `GOOGLE_SA_PRIVATE_KEY`. Enable the Google Drive API
   on the project. In Google Drive create a **Shared drive** (e.g. "Mileage"), add the service account address as
   Content manager, create a folder "Mileage logs" in it, and copy the folder id from its URL into `DRIVE_FOLDER_ID`.
   (A shared drive is needed because service accounts can't own files in someone's My Drive.)
   Files are named `Mileage log YYYY-MM - name@ovanova.co.csv`, one per person per month, rewritten on each change.
4. **Deploy:** `cd tesla-site && vercel deploy --prod`.
   The batch is checked every 5 minutes by the existing GitHub Actions poll (`.github/workflows/mileage-poll.yml` →
   `/api/cron`, needs the repo secret `MILEAGE_CRON_SECRET` = `CRON_SECRET`), so it goes out within ~5 minutes of
   Friday 17:00 Central. As a backup, a Vercel cron hits `/api/phone/cron` Fridays 23:05 UTC (17:05 CST / 18:05 CDT;
   Hobby crons can fire any time within that hour). Each Friday moment is sent only once.
   The web app (`/api/app`) now uses the same rules, so a web or Tesla-triggered send never includes company-car
   or superseded trips.
5. **Device tokens:** for each person run
   `SESSION_SECRET=<same value> node tools/device-token.js john@ovanova.co "John"` and give them the token.
   Valid one year; changing `SESSION_SECRET` revokes all tokens.

## iPhone app build (Expo, free)
1. `cd mobile && npm install && npx eas-cli login` (free Expo account) and `npx eas-cli init` to link the project.
2. `npx eas-cli build -p ios --profile production` – signs with Lester's Apple Developer account (EAS asks for the Apple ID).
3. `npx eas-cli submit -p ios` – uploads to App Store Connect. In TestFlight, add John and Chris as internal testers.
   (Alternative without TestFlight: `--profile preview` with their device UDIDs registered via `eas device:create`.)
4. On each phone: install from TestFlight, open Settings tab → paste the device token → Pair. Add cars in the Cars tab
   (mark company cars and Teslas). Turn on Automatic trip tracking and choose **Always** for location.
