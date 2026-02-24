"""
Calendly Clone – FastAPI backend
Serves the API and the static frontend from a single process.
"""

import os
import secrets
from datetime import datetime, timedelta, date, time, timezone
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import httpx

from dotenv import load_dotenv

load_dotenv()

# ── Bootstrap DB ──────────────────────────────────────────────────────────────
from database import get_db, engine
import models

models.Base.metadata.create_all(bind=engine)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Calendly Clone", docs_url="/api/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
TOKEN_DAYS = 30

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
GOOGLE_REDIRECT_URI = f"{BACKEND_URL}/api/auth/google/callback"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar",
]


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ── Google Calendar helpers ───────────────────────────────────────────────────

def _get_google_service(user: models.User, db: Session):
    """Return an authorised Google Calendar service, refreshing the token if needed."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from google.auth.transport.requests import Request as GRequest

    if not user.google_access_token:
        raise HTTPException(status_code=400, detail="Google Calendar not connected")

    creds = Credentials(
        token=user.google_access_token,
        refresh_token=user.google_refresh_token,
        token_uri=GOOGLE_TOKEN_URL,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=GOOGLE_SCOPES,
    )

    if user.google_token_expiry and datetime.utcnow() > user.google_token_expiry:
        creds.refresh(GRequest())
        user.google_access_token = creds.token
        if creds.expiry:
            user.google_token_expiry = creds.expiry.replace(tzinfo=None)
        db.commit()

    return build("calendar", "v3", credentials=creds)


def _parse_gcal_dt(s: str) -> datetime:
    """Convert a Google Calendar ISO timestamp to a naive UTC datetime."""
    if s.endswith("Z"):
        return datetime.fromisoformat(s[:-1])
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _busy_times(service, start: datetime, end: datetime) -> List[tuple]:
    """Fetch busy intervals from Google Calendar (primary calendar)."""
    try:
        body = {
            "timeMin": start.isoformat() + "Z",
            "timeMax": end.isoformat() + "Z",
            "items": [{"id": "primary"}],
        }
        result = service.freebusy().query(body=body).execute()
        raw = result.get("calendars", {}).get("primary", {}).get("busy", [])
        return [(_parse_gcal_dt(b["start"]), _parse_gcal_dt(b["end"])) for b in raw]
    except Exception:
        return []


def _available_slots(
    user: models.User,
    event_type: models.EventType,
    target_date: date,
    db: Session,
    gcal_service=None,
) -> List[dict]:
    """Return a list of {start, end} dicts (ISO strings) for an available slots on target_date."""
    dow = target_date.weekday()  # 0=Monday
    avail = (
        db.query(models.Availability)
        .filter(
            models.Availability.user_id == user.id,
            models.Availability.day_of_week == dow,
            models.Availability.is_active.is_(True),
        )
        .first()
    )
    if not avail:
        return []

    sh, sm = map(int, avail.start_time.split(":"))
    eh, em = map(int, avail.end_time.split(":"))
    day_start = datetime.combine(target_date, time(sh, sm))
    day_end = datetime.combine(target_date, time(eh, em))

    # Don't offer slots that have already passed (+ 1-hour buffer)
    cutoff = datetime.utcnow() + timedelta(hours=1)
    if day_end <= cutoff:
        return []

    # Busy from Google Calendar
    busy: List[tuple] = []
    if gcal_service:
        busy = _busy_times(gcal_service, day_start, day_end)

    # Busy from existing confirmed bookings
    existing = (
        db.query(models.Booking)
        .join(models.EventType)
        .filter(
            models.EventType.user_id == user.id,
            models.Booking.start_time >= day_start,
            models.Booking.start_time < day_end,
            models.Booking.status == "confirmed",
        )
        .all()
    )
    for b in existing:
        busy.append((b.start_time, b.end_time))

    duration = timedelta(minutes=event_type.duration_minutes)
    slots = []
    current = max(day_start, cutoff.replace(second=0, microsecond=0))
    # Round up to next 15-minute mark
    minutes = current.minute
    remainder = minutes % 15
    if remainder:
        current += timedelta(minutes=15 - remainder)
    current = current.replace(second=0, microsecond=0)

    while current + duration <= day_end:
        slot_end = current + duration
        free = all(current >= be or slot_end <= bs for bs, be in busy)
        if free:
            slots.append({"start": current.isoformat(), "end": slot_end.isoformat()})
        current += timedelta(minutes=15)

    return slots


# ── Static files + HTML pages ─────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def _html(filename: str) -> HTMLResponse:
    path = os.path.join(STATIC_DIR, filename)
    with open(path) as f:
        return HTMLResponse(f.read())


@app.get("/", response_class=HTMLResponse)
async def root():
    return _html("index.html")


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page():
    return _html("dashboard.html")


@app.get("/availability", response_class=HTMLResponse)
async def availability_page():
    return _html("availability.html")


@app.get("/book/{username}/{slug}", response_class=HTMLResponse)
async def book_page(username: str, slug: str):
    return _html("book.html")


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.get("/api/auth/google")
async def google_auth():
    """Redirect the browser to Google's OAuth consent screen."""
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    }
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{qs}")


@app.get("/api/auth/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    """Exchange the authorisation code for tokens and sign the user in."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        token_data = resp.json()

    if "error" in token_data:
        raise HTTPException(400, token_data.get("error_description", "OAuth error"))

    access_token = token_data["access_token"]
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)

    async with httpx.AsyncClient() as client:
        ui = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info = ui.json()

    email = info["email"]
    name = info.get("name", email.split("@")[0])
    picture = info.get("picture")

    user = db.query(models.User).filter(models.User.email == email).first()

    if not user:
        # Build a unique username from the email local-part
        base = "".join(c for c in email.split("@")[0].lower() if c.isalnum() or c == "-")
        username = base
        counter = 1
        while db.query(models.User).filter(models.User.username == username).first():
            username = f"{base}{counter}"
            counter += 1

        user = models.User(email=email, name=name, picture_url=picture, username=username)
        db.add(user)
        db.flush()

        # Default availability: Mon–Fri 09:00–17:00
        for dow in range(5):
            db.add(models.Availability(
                user_id=user.id, day_of_week=dow,
                start_time="09:00", end_time="17:00", is_active=True,
            ))

        # Default event type
        db.add(models.EventType(
            user_id=user.id, name="30 Minute Meeting",
            slug="30-minute-meeting", duration_minutes=30,
            description="Let's connect for 30 minutes.", color="#0069ff",
        ))

    user.google_access_token = access_token
    if refresh_token:
        user.google_refresh_token = refresh_token
    user.google_token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)
    user.name = name
    user.picture_url = picture
    db.commit()

    jwt_token = create_token(user.id)
    return RedirectResponse(f"/dashboard?token={jwt_token}")


@app.get("/api/auth/me")
async def me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "picture_url": current_user.picture_url,
        "username": current_user.username,
        "google_connected": bool(current_user.google_access_token),
    }


# ── Event types ───────────────────────────────────────────────────────────────

def _et_dict(et: models.EventType) -> dict:
    return {
        "id": et.id,
        "name": et.name,
        "slug": et.slug,
        "duration_minutes": et.duration_minutes,
        "description": et.description,
        "color": et.color,
        "is_active": et.is_active,
        "location": et.location,
    }


@app.get("/api/event-types")
async def list_event_types(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ets = (
        db.query(models.EventType)
        .filter(models.EventType.user_id == current_user.id)
        .order_by(models.EventType.created_at)
        .all()
    )
    return [_et_dict(et) for et in ets]


@app.post("/api/event-types", status_code=201)
async def create_event_type(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = await request.json()
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(400, "name is required")

    raw_slug = "".join(
        c if c.isalnum() or c == "-" else "-"
        for c in name.lower().replace(" ", "-")
    ).strip("-")
    slug = raw_slug
    counter = 1
    while db.query(models.EventType).filter(
        models.EventType.user_id == current_user.id,
        models.EventType.slug == slug,
    ).first():
        slug = f"{raw_slug}-{counter}"
        counter += 1

    et = models.EventType(
        user_id=current_user.id,
        name=name,
        slug=slug,
        duration_minutes=int(data.get("duration_minutes", 30)),
        description=data.get("description", ""),
        color=data.get("color", "#0069ff"),
        location=data.get("location", ""),
    )
    db.add(et)
    db.commit()
    db.refresh(et)
    return _et_dict(et)


@app.put("/api/event-types/{event_id}")
async def update_event_type(
    event_id: int,
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    et = db.query(models.EventType).filter(
        models.EventType.id == event_id,
        models.EventType.user_id == current_user.id,
    ).first()
    if not et:
        raise HTTPException(404, "Event type not found")

    data = await request.json()
    for field in ("name", "description", "color", "location"):
        if field in data:
            setattr(et, field, data[field])
    if "duration_minutes" in data:
        et.duration_minutes = int(data["duration_minutes"])
    if "is_active" in data:
        et.is_active = bool(data["is_active"])

    db.commit()
    return _et_dict(et)


@app.delete("/api/event-types/{event_id}")
async def delete_event_type(
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    et = db.query(models.EventType).filter(
        models.EventType.id == event_id,
        models.EventType.user_id == current_user.id,
    ).first()
    if not et:
        raise HTTPException(404, "Event type not found")
    db.delete(et)
    db.commit()
    return {"ok": True}


# ── Availability ──────────────────────────────────────────────────────────────

@app.get("/api/availability")
async def get_availability(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.Availability)
        .filter(models.Availability.user_id == current_user.id)
        .order_by(models.Availability.day_of_week)
        .all()
    )
    return [
        {"id": r.id, "day_of_week": r.day_of_week,
         "start_time": r.start_time, "end_time": r.end_time, "is_active": r.is_active}
        for r in rows
    ]


@app.put("/api/availability")
async def update_availability(
    request: Request,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = await request.json()
    for item in data:
        dow = int(item["day_of_week"])
        row = db.query(models.Availability).filter(
            models.Availability.user_id == current_user.id,
            models.Availability.day_of_week == dow,
        ).first()
        if row:
            row.start_time = item.get("start_time", row.start_time)
            row.end_time = item.get("end_time", row.end_time)
            row.is_active = bool(item.get("is_active", row.is_active))
        else:
            db.add(models.Availability(
                user_id=current_user.id, day_of_week=dow,
                start_time=item.get("start_time", "09:00"),
                end_time=item.get("end_time", "17:00"),
                is_active=bool(item.get("is_active", True)),
            ))
    db.commit()
    return {"ok": True}


# ── Bookings (host view) ──────────────────────────────────────────────────────

@app.get("/api/bookings")
async def list_bookings(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bookings = (
        db.query(models.Booking)
        .join(models.EventType)
        .filter(models.EventType.user_id == current_user.id)
        .order_by(models.Booking.start_time)
        .all()
    )
    return [
        {
            "id": b.id,
            "event_type": b.event_type.name,
            "invitee_name": b.invitee_name,
            "invitee_email": b.invitee_email,
            "start_time": b.start_time.isoformat(),
            "end_time": b.end_time.isoformat(),
            "status": b.status,
            "notes": b.notes,
        }
        for b in bookings
    ]


@app.delete("/api/bookings/{booking_id}")
async def cancel_booking(
    booking_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    booking = (
        db.query(models.Booking)
        .join(models.EventType)
        .filter(
            models.Booking.id == booking_id,
            models.EventType.user_id == current_user.id,
        )
        .first()
    )
    if not booking:
        raise HTTPException(404, "Booking not found")

    if booking.google_event_id:
        try:
            svc = _get_google_service(current_user, db)
            svc.events().delete(calendarId="primary", eventId=booking.google_event_id).execute()
        except Exception:
            pass

    booking.status = "cancelled"
    db.commit()
    return {"ok": True}


# ── Public booking (no auth required) ────────────────────────────────────────

@app.get("/api/book/{username}")
async def public_user(username: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(404, "User not found")

    ets = (
        db.query(models.EventType)
        .filter(
            models.EventType.user_id == user.id,
            models.EventType.is_active.is_(True),
        )
        .all()
    )
    return {
        "name": user.name,
        "username": user.username,
        "picture_url": user.picture_url,
        "event_types": [_et_dict(et) for et in ets],
    }


@app.get("/api/book/{username}/{slug}/slots")
async def get_slots(
    username: str,
    slug: str,
    date_str: str,
    db: Session = Depends(get_db),
):
    """Return available slots for a given date (YYYY-MM-DD query param)."""
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(404, "User not found")

    et = db.query(models.EventType).filter(
        models.EventType.user_id == user.id,
        models.EventType.slug == slug,
        models.EventType.is_active.is_(True),
    ).first()
    if not et:
        raise HTTPException(404, "Event type not found")

    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(400, "Invalid date (use YYYY-MM-DD)")

    if target_date < date.today():
        return []

    gcal = None
    if user.google_access_token:
        try:
            gcal = _get_google_service(user, db)
        except Exception:
            pass

    return _available_slots(user, et, target_date, db, gcal)


@app.post("/api/book/{username}/{slug}")
async def create_booking(
    username: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(404, "User not found")

    et = db.query(models.EventType).filter(
        models.EventType.user_id == user.id,
        models.EventType.slug == slug,
        models.EventType.is_active.is_(True),
    ).first()
    if not et:
        raise HTTPException(404, "Event type not found")

    data = await request.json()
    invitee_name = data.get("name", "").strip()
    invitee_email = data.get("email", "").strip()
    start_str = data.get("start_time", "")
    notes = data.get("notes", "")

    if not all([invitee_name, invitee_email, start_str]):
        raise HTTPException(400, "name, email, and start_time are required")

    try:
        start_time = datetime.fromisoformat(start_str)
    except ValueError:
        raise HTTPException(400, "Invalid start_time (use ISO format)")

    end_time = start_time + timedelta(minutes=et.duration_minutes)

    booking = models.Booking(
        event_type_id=et.id,
        invitee_name=invitee_name,
        invitee_email=invitee_email,
        start_time=start_time,
        end_time=end_time,
        notes=notes,
        status="confirmed",
    )
    db.add(booking)
    db.flush()

    # Create Google Calendar event (best-effort)
    google_event_id = None
    if user.google_access_token:
        try:
            svc = _get_google_service(user, db)
            evt = {
                "summary": f"{et.name} with {invitee_name}",
                "description": f"Booked by: {invitee_email}\n\nNotes: {notes}",
                "start": {"dateTime": start_time.isoformat() + "Z", "timeZone": "UTC"},
                "end": {"dateTime": end_time.isoformat() + "Z", "timeZone": "UTC"},
                "attendees": [{"email": user.email}, {"email": invitee_email}],
            }
            if et.location:
                evt["location"] = et.location

            created = svc.events().insert(
                calendarId="primary", body=evt, sendUpdates="all"
            ).execute()
            google_event_id = created.get("id")
            booking.google_event_id = google_event_id
        except Exception:
            pass

    db.commit()

    return {
        "id": booking.id,
        "event_type": et.name,
        "host_name": user.name,
        "invitee_name": invitee_name,
        "invitee_email": invitee_email,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "google_event_created": bool(google_event_id),
    }
