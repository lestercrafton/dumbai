# Remaining one-time setup (Lester only)

## Already done
- **EC prime256v1 key pair** generated. The private key is at `/workspace/mileage-tracker-secrets/private.pem` (chmod 600, outside git; the folder is 700). The public key is committed in `tesla-site/public/.well-known/appspecific/`.
- **Vercel project `ovanova-mileage-tesla`** is deployed to production on your account (lester-crafton) at **https://ovanova-mileage-tesla.vercel.app**:
  - Public key: https://ovanova-mileage-tesla.vercel.app/.well-known/appspecific/com.tesla.3p.public-key.pem returns 200 `application/x-pem-file`, and the content matches the generated key.
  - Token broker: `https://ovanova-mileage-tesla.vercel.app/token` (the same handler is also at `/api/token`). A GET to `/api/token` returns `{"ok":true,"configured":false}` until the env vars below are set.
- **`app-config.json`** is pre-filled with the redirect URI `http://localhost:8765/callback`, the broker URL, the partner domain, the Sugar address, and micro (VIN 7SAYGDEE4RA246655, owner lester@ovanova.co).
- **The partner registration call** is scripted in `tools/tesla-register-partner.sh`.

## 1. Google sign-in client (about 5 minutes)
1. Go to https://console.cloud.google.com/ while signed in as lester@ovanova.co. In the project picker, choose **New project**, name it `Ovanova Mileage Tracker`, and click **Create**.
2. Open **APIs & Services → OAuth consent screen** (shown as "Google Auth Platform → Branding" in newer consoles) and click **Get started**.
   - App name: `Ovanova Mileage Tracker`. User support email: lester@ovanova.co.
   - Audience: choose **Internal**. Lester, Chris and John all use ovanova.co Google Workspace accounts, so Internal means no test-user list and no Google verification.
   - Contact email: lester@ovanova.co. Click **Create**.
   - *If Internal is not offered* (the project is not under the ovanova.co organization), choose **External**. Then go to **Audience → Test users → Add users** and enter `john@ovanova.co` and `c@ovanova.co` (Chris Snodgrass's address, from Gmail). You are added automatically as the owner.
3. Open **Data access → Add or remove scopes**, tick `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`, then click **Update** and **Save**.
4. Open **Clients → Create client**, choose application type **Desktop app**, name it `Mileage Tracker desktop`, and click **Create**.
5. Copy the **Client ID** into `app-config.json` under `google.clientId`. Google labels a desktop client's secret as non-confidential; put it in `google.clientSecret`, or pass it as the env var `GOOGLE_CLIENT_SECRET` at launch.

## 2. Tesla developer app (about 10 minutes)
1. Go to https://developer.tesla.com, sign in with your Tesla account, and click **Request app access** (or **Create application**).
2. Fill in:
   - Application name: `Ovanova Mileage Tracker`
   - Description: `Tracks business mileage for Ovanova employees' own Teslas (odometer, shift state, location) to produce IRS-rate reimbursement reports.`
   - Purpose of usage: personal and business mileage logging (read-only vehicle data)
   - **OAuth grant type:** Authorization Code and Machine-to-Machine
   - **Allowed origin(s):** `https://ovanova-mileage-tesla.vercel.app`
   - **Allowed redirect URI(s):** `http://localhost:8765/callback`
   - **Allowed returned URL(s)** (if asked): `https://ovanova-mileage-tesla.vercel.app`
   - **Scopes:** tick **Vehicle Information** (`vehicle_device_data`) and **Vehicle Location** (`vehicle_location`). Leave Vehicle Commands, Charging and Energy unticked.
   - Billing: add a card if prompted; the monthly free credit is expected to cover this usage.
3. Submit. Then open the app's **Credentials & APIs** and copy the **Client ID** and **Client Secret**.
4. Put the **Client ID** into `app-config.json` under `tesla.clientId`. It is not a secret.
5. Store both values in Vercel. This can be done from the repo folder:
   ```
   cd /workspace/mileage-tracker/tesla-site
   vercel env add TESLA_CLIENT_ID production       # paste the client id
   vercel env add TESLA_CLIENT_SECRET production   # paste the secret
   vercel deploy --prod --yes
   ```
   Alternatively, use the Vercel dashboard: ovanova-mileage-tesla → Settings → Environment Variables. After redeploying, `curl https://ovanova-mileage-tesla.vercel.app/api/token` should show `"configured":true`.
6. Register the partner domain once:
   ```
   TESLA_CLIENT_ID=... TESLA_CLIENT_SECRET=... ./tools/tesla-register-partner.sh
   ```
   The script prints the registered public key; it should match `tesla-site/public/.well-known/appspecific/com.tesla.3p.public-key.pem`.

## 3. Gmail app password (for sending to Sugar)
1. 2-Step Verification must be on: https://myaccount.google.com/security. App passwords only appear once 2-Step Verification is on. As Workspace admin, make sure admin.google.com → Security → Authentication → 2-step verification has "Allow users to turn on 2-Step Verification" checked.
2. Go to https://myaccount.google.com/apppasswords, enter the name `Mileage Tracker`, click **Create**, and copy the 16-character password.
3. In the app, under **Settings → Your email account**: Host `smtp.gmail.com`, Port `587`, TLS-on-connect `No (STARTTLS)`, User `lester@ovanova.co`, Password = the app password, From `lester@ovanova.co`. Alternatively, set the env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`.
   Chris and John do the same with their own accounts.

## 4. Final check
Run `npm ci && npm start`. Then: **Sign in with Google** → Vehicles → micro → **Connect my Tesla** → approve → tick micro. The header then shows micro's gear and odometer.
