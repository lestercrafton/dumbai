# Mileage Tracker (desktop)

An Electron desktop app. It reads trips straight from each user's Tesla. After every trip it asks whether the trip was business, then emails the reimbursement to Sugar either right away ("Send now") or in one combined email at the end of the week ("Wait till end of week"). It is free and self-hosted: data is JSON files on each computer, email goes through your own SMTP account, and phone push uses ntfy, which is optional and can be self-hosted.

## Run
```
npm ci            # pinned versions (package-lock.json, .npmrc save-exact)
npm start         # launch the app
npm test          # unit/integration tests (local SMTP catcher only)
npm run selftest  # end-to-end: real Electron app, simulated cars, local SMTP catcher (uses xvfb-run if no display)
```

## What end users do (Lester, Chris, John, anyone)
1. Click **Sign in with Google**. This creates or opens their local account. Cars, trips, reports and Sugar settings are kept per account.
2. Open **Vehicles**, click **Add vehicle (Connect my Tesla)**, sign in to Tesla in the browser, approve access, and tick their car(s). No developer app and no keys are needed.
   - Lester's account comes with **micro** (Tesla Model Y Dual Motor, VIN 7SAYGDEE4RA246655) already set up. He only clicks **Connect my Tesla** once on that row.
3. Open **Settings** and enter their own SMTP details, for example Gmail with an app password: host `smtp.gmail.com`, port 587, user, app password. These can also be set with the env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. The Sugar recipient is prefilled as sugar@ovanova.co and can be changed. Add a signature. Optionally add an ntfy topic for phone push.
4. After each trip, a desktop notification appears and a dialog offers: **Business — Send now**, **Business — Wait till end of week**, **Business — decide later**, or **Personal**. The Trips and Report screens have the same Send now and Wait buttons.

## One-time admin setup (Lester)
1. **Google OAuth client.** In Google Cloud Console, open APIs & Services and then Credentials. Create an OAuth client ID of type **Desktop app**, and set the consent screen to External with scopes `openid email profile`. Put the client ID in `app-config.json` under `google.clientId`. If Google issues a desktop client secret, put it under `google.clientSecret`; Google documents desktop secrets as non-confidential, but you can supply it with `GOOGLE_CLIENT_SECRET` instead. While the consent screen is in "Testing" mode, add Chris and John as test users, or publish the app.
2. **One shared Tesla Fleet API app.** At developer.tesla.com, create one application with the scopes Vehicle Information and Vehicle Location, the redirect URI `http://localhost:8765/callback`, and an allowed origin on your domain. Put the client ID in `app-config.json` under `tesla.clientId`.
3. **Public key on a domain.** Generate a key pair with `openssl ecparam -name prime256v1 -genkey -noout -out private.pem && openssl ec -in private.pem -pubout -out public.pem`. Serve `public.pem` at `https://YOUR-DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem`. A free static host works, for example GitHub Pages, Cloudflare Pages, or a path on ovanova.co. Keep `private.pem` offline.
4. **Register the partner account.** Do this once per region (NA): get a partner token with `client_credentials`, then `POST /api/1/partner_accounts {"domain":"YOUR-DOMAIN"}`.
5. **Token broker.** This is what keeps the Tesla client secret out of the desktop app. Run `TESLA_CLIENT_ID=… TESLA_CLIENT_SECRET=… node tools/tesla-token-broker.js` on any free or cheap always-on host with HTTPS, for example a home server behind Cloudflare Tunnel, or Fly/Render free tiers. Put its URL in `app-config.json` under `tesla.tokenBroker`. It only proxies the authorization-code and refresh grants (PKCE). For development without a broker, set `TESLA_CLIENT_SECRET` in the environment.
6. Ship the build with the filled-in `app-config.json`. That file contains no secrets.

Fleet API usage is billed per request, with a monthly free credit. Polling every 60 s while parked and every 10 s while driving should normally stay within that credit for a few cars; check the dashboard. A sleeping car (HTTP 408) is never woken.

## TeslaMate (optional, self-hosted)
In Settings, enter a Postgres URL (or set `TESLAMATE_DATABASE_URL`), pick the vehicle, and click **Import drives**. The app reads TeslaMate's `drives` and `addresses` tables.

## Reliability notes
- **Trip detection:** a trip starts when `shift_state` leaves P and ends when it returns to P. Polling runs at 10 s while driving and for 5 minutes after parking. If the odometer moved between two parked polls, the app records an inferred trip, marked `*`. Every completed trip produces exactly one notification and one stored trip, with no minimum distance.
- **Retries:** exponential backoff with jitter on Tesla calls (429/5xx/network; 401 shows "Connect my Tesla again"), SMTP (network/4xx; a login failure shows a clear error), and ntfy. When polling keeps failing, the interval backs off up to 15 minutes, and the error appears in the header.
- **Queue:** the "end of week" queue is stored in `trips.json`. The scheduler checks every minute and once at launch, so if Friday 17:00 passed while the app was closed, the queued trips go out on the next launch. Each scheduled moment sends only once.
- **Double-submit guard:** a trip is marked `reimbursedAt` once the SMTP server accepts the message. Sent trips can't be sent or queued again, and only one send runs at a time.
- **Schedules:** end-of-week time defaults to Friday 17:00 local and is configurable. A separate auto-send (weekly or monthly) is OFF by default. Report screen: Preview email, Send now, Wait till end of week, CSV, Save PDF, Print. Rate: IRS by trip date (2026: $0.725 Jan–Jun, $0.76 from Jul 1), or an override.

## Multi-computer sharing (not built)
Each person signs in on their own computer and their data stays there. If you want one shared dataset, the simplest free option is to point `MT_DATA_DIR` at a folder synced with Syncthing (self-hosted, peer-to-peer), using one computer per account at a time.

## Limitations / untested against real services
- Google sign-in, the Tesla OAuth and Fleet API calls, the token broker, ntfy.sh, TeslaMate, and real SMTP providers are written against their published docs. They are covered by mocks or the local SMTP catcher only and have not been run against the live services.
- Push notifications are desktop notifications on the computer of the account that owns the car; phone push needs ntfy. Short drives that start and end between two polls, with no odometer change visible, are a known gap.
- Tokens and the SMTP password are stored in plain JSON in the user's app-data folder; prefer the env vars.

## Web version (https://ovanova-mileage-tesla.vercel.app)
Same Vercel project as the Tesla partner domain (`tesla-site/`): `/.well-known/...public-key.pem` and `/token` are unchanged.
- `api/app.js` + `lib/` serve Google sign-in (@ovanova.co only), Connect my Tesla, trips, tagging, Send now / batch for Friday 17:00 Central, and ntfy push with Yes · Send now / Yes · Batch / No buttons. `lib/core.js` is the desktop `src/core.js`, unchanged (a test checks this).
- Storage: Upstash Redis free tier connected through the Vercel Marketplace (`KV_REST_API_URL`/`KV_REST_API_TOKEN`).
- Polling: Vercel Hobby cron runs only once a day, so `.github/workflows/mileage-poll.yml` calls `/api/cron` every 5 minutes (GitHub schedules can run late). A sleeping car is never woken.
- Env (Vercel): `SESSION_SECRET`, `CRON_SECRET` (same value as GitHub secret `MILEAGE_CRON_SECRET`), `TESLA_CLIENT_ID/SECRET`, `GOOGLE_WEB_CLIENT_ID/SECRET`, `SMTP_HOST/PORT/USER/PASS/FROM`, `PUBLIC_URL`.
- Redirect URIs: Google `https://ovanova-mileage-tesla.vercel.app/auth/google/callback`, Tesla `https://ovanova-mileage-tesla.vercel.app/auth/tesla/callback`.
- Mail goes out from lester@ovanova.co; for other users it is sent "via Mileage Tracker" with their address as reply-to and cc. Attachments: odometer captures (HTML) and CSV.
- Tests: `cd tesla-site && npm ci && npm test` (in-memory storage, mocked Google/Tesla/ntfy, local SMTP catcher).
