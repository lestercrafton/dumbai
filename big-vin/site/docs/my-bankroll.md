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

Migration `0008_my_bankroll` adds `my_bankroll_users`, `my_bankroll_starts`, `my_bankroll_otps`.

## Disclaimer

Pages remind visitors: entertainment purposes only; not financial advice; for humans and agents.
