# CalSync – Calendly clone with Google Calendar sync

A self-hosted scheduling app. Share a link, let people pick a time, and every
booking automatically creates a Google Calendar event for both parties.

---

## Quick start

### 1. Set up Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Add an **Authorized redirect URI**:
   ```
   http://localhost:8000/api/auth/google/callback
   ```
5. Copy the **Client ID** and **Client Secret**

### 2. Enable the Google Calendar API

In the same project: **APIs & Services** → **Library** → search "Google Calendar API" → **Enable**

### 3. Configure the app

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and fill in:
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   SECRET_KEY=<random string>
```

Generate a secret key:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### 4. Run

```bash
# Python 3.9+ required
pip install -r backend/requirements.txt
./run.sh
```

Open **http://localhost:8000** in your browser.

---

## How it works

| Page | URL | Description |
|------|-----|-------------|
| Landing | `/` | Sign in with Google |
| Dashboard | `/dashboard` | Manage event types & view bookings |
| Availability | `/availability` | Set your weekly schedule |
| Booking | `/book/{username}/{slug}` | Public page visitors use to book time |

### Flow for you (the host)

1. Sign in with Google (grants calendar access)
2. A default "30 Minute Meeting" event type is created automatically
3. Adjust your availability under **Availability**
4. Create more event types from **Dashboard**
5. Share your booking link (shown at the top of the dashboard)

### Flow for visitors

1. Open your booking link
2. Pick a date → select a free slot → enter name + email → confirm
3. A Google Calendar event is created and invites are sent to both parties

---

## Project structure

```
.
├── backend/
│   ├── main.py          # FastAPI app – all routes and business logic
│   ├── models.py        # SQLAlchemy database models
│   ├── database.py      # DB engine + session setup
│   ├── requirements.txt
│   └── .env.example     # Copy to .env and fill in secrets
├── static/
│   ├── index.html       # Landing page
│   ├── dashboard.html   # Host dashboard
│   ├── availability.html
│   └── book.html        # Public booking page
└── run.sh               # One-command start script
```

## Notes

- All times are stored in **UTC**. The booking page converts to the visitor's
  local timezone automatically using the browser's `Intl` API.
- The SQLite database file (`calendly.db`) is created inside `backend/` on
  first run – no database setup required.
- For production, set `BACKEND_URL` to your public HTTPS domain and update
  the Google OAuth redirect URI accordingly.
