#!/usr/bin/env bash
# One-time: register the partner domain with Tesla Fleet API (NA region). Needs the Tesla app's client id/secret.
#   TESLA_CLIENT_ID=... TESLA_CLIENT_SECRET=... ./tools/tesla-register-partner.sh
set -euo pipefail
: "${TESLA_CLIENT_ID:?set TESLA_CLIENT_ID}" "${TESLA_CLIENT_SECRET:?set TESLA_CLIENT_SECRET}"
DOMAIN="${DOMAIN:-ovanova-mileage-tesla.vercel.app}"
API="${API:-https://fleet-api.prd.na.vn.cloud.tesla.com}"
curl -fsS "https://$DOMAIN/.well-known/appspecific/com.tesla.3p.public-key.pem" >/dev/null && echo "public key reachable on $DOMAIN"
RESP=$(curl -sS -w '\n%{http_code}' -X POST https://auth.tesla.com/oauth2/v3/token \
  -d grant_type=client_credentials --data-urlencode client_id="$TESLA_CLIENT_ID" --data-urlencode client_secret="$TESLA_CLIENT_SECRET" \
  --data-urlencode "scope=openid vehicle_device_data vehicle_location" --data-urlencode "audience=$API")
CODE=${RESP##*$'\n'}; BODY=${RESP%$'\n'*}
if [ "$CODE" != 200 ]; then echo "Token request failed: HTTP $CODE: $BODY" >&2; exit 1; fi
TOKEN=$(printf %s "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -fsS -X POST "$API/api/1/partner_accounts" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"domain\":\"$DOMAIN\"}"; echo
echo "Verify:"; curl -fsS "$API/api/1/partner_accounts/public_key?domain=$DOMAIN" -H "Authorization: Bearer $TOKEN"; echo
