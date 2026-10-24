# My Bankroll

Personal Kelly bankrolls sized to each visitor’s starting amounts.

## Auth

Email-only one-time codes (no passwords). Session is an HttpOnly `Secure` `SameSite=Lax` cookie (`bv_mb`), HMAC-signed.

## Secrets (Cloudflare Worker)

| Secret | Required | Purpose |
|--------|----------|---------|
| `MY_BANKROLL_SESSION_SECRET` | Yes (≥16 chars) | Signs sessions and OTP hashes. Falls back to `BIG_VIN_ADMIN_TOKEN` if unset. |
| `RESEND_API_KEY` | For real email | Sends the 6-digit code via [Resend](https://resend.com) free tier. |
| `MY_BANKROLL_FROM_EMAIL` | Optional | From address (default `Big Vin <onboarding@resend.dev>` until a domain is verified). |

Without `RESEND_API_KEY`, the API returns the code in the response so the UI can show **demo mode**. Set `RESEND_API_KEY` for production email delivery.

```bash
# From big-vin/site, personal Cloudflare account:
XDG_CONFIG_HOME=/home/box/.wrangler-lcrafton \
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler secret put MY_BANKROLL_SESSION_SECRET --config wrangler.cloudflare.jsonc
XDG_CONFIG_HOME=/home/box/.wrangler-lcrafton \
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler secret put RESEND_API_KEY --config wrangler.cloudflare.jsonc
```

## D1

Migration `0008_my_bankroll` adds `my_bankroll_users`, `my_bankroll_starts`, `my_bankroll_otps`. Migration `0009_my_bankroll_effective` adds `effective_from` so an override balance only applies Vin’s plays from that Chicago day forward (carryforward display uses full Kelly replay from the saved start).

OTP email copy lives in `lib/my-bankroll-email.mjs` and includes the Cash App karma link `https://cash.app/$bigvinsports` (same as Boost / `SITE_CONFIG.donation.href`).

## Disclaimer

Pages remind visitors: entertainment purposes only; not financial advice; for humans and agents.

## Kalshi

My Bankroll can deep-link Vin’s picks into matching Kalshi sports markets, and (opt-in) place recommended sizes with each visitor’s own Kalshi API key.

### Deep links (default)

- Today’s plays calls `POST /api/my-bankroll/kalshi/matches` with compact pick descriptors.
- The Worker searches Kalshi’s public Trade API (`https://api.elections.kalshi.com/trade-api/v2`, same data as `external-api.kalshi.com`) for open sports series (`KXNCAAFGAME`, `KXNFLGAME`, spreads/totals, etc.).
- Matching prefers game-winner markets; spreads/totals only when Kalshi lists a clear line. No match → muted “No Kalshi market”. Deep links never place trades.

### Go full (opt-in)

- On Starting bankrolls, **Go full with Kalshi** lets a signed-in user paste their Kalshi API Key ID + private key PEM.
- Credentials are AES-GCM encrypted with `MY_BANKROLL_SESSION_SECRET` and stored in D1 `my_bankroll_kalshi` (never logged).
- Save runs a live `GET /portfolio/balance` test before persisting.
- When connected, Today’s plays can show **Place on Kalshi** (confirm step) using Create Order V2 (`POST /portfolio/events/orders`) at the recommended $ size for YES-side contracts. Underdog/NO still uses Open on Kalshi.
- Entertainment disclaimer stays on the page.

### Migration

`0010_my_bankroll_kalshi` adds the credentials table. Apply with:

```bash
XDG_CONFIG_HOME=/home/box/.wrangler-lcrafton \
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler d1 migrations apply big-vin --remote --config wrangler.cloudflare.jsonc
```

### Today's plays vs All picks

- **Today's plays** keeps recommended full-Kelly sizes (including “No pick” rows for Kelly-zero games).
- **All picks** lists the same board ranked by Kelly / confidence, including passes, with an open **Amount** field. Place on Kalshi uses the typed amount, or the recommended size when the field is blank (and Place stays hidden when that resolves to $0).

### Referral / affiliate

Kalshi’s public program is **refer-a-friend trading credits**, not a cash affiliate or CPA payout for publishers:

- In the Kalshi app: Explore → menu → Your rewards → referral offer → share link or code.
- Rewards are typically **credits** (often with trade-before-withdraw rules), amounts vary by offer, U.S.-eligible users only.
- There is **no public cash affiliate** that pays Big Vin for referred traders. Third-party “revenue share” pages are not Kalshi’s program. Private partnership deals may exist via Kalshi business development, but are not self-serve.

When Lester has a personal invite code or link, set Worker env **`KALSHI_REFERRAL_CODE`** (bare code or full invite URL). Bare codes are appended as `?r=` on Open on Kalshi market deep links; a join URL is exposed to the UI for “Open on Kalshi” / new-user copy. Full invite URLs are used as the join landing and leave market deep links unchanged.

```bash
# Optional — only after you have a Kalshi invite code/link from Your rewards:
XDG_CONFIG_HOME=/home/box/.wrangler-lcrafton \
  env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY -u CLOUDFLARE_ACCOUNT_ID \
  npx wrangler secret put KALSHI_REFERRAL_CODE --config wrangler.cloudflare.jsonc
# Or set the non-secret vars.KALSHI_REFERRAL_CODE in wrangler.cloudflare.jsonc and redeploy.
```
