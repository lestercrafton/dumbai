from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    picture_url = Column(String, nullable=True)
    username = Column(String, unique=True, index=True, nullable=False)
    google_access_token = Column(Text, nullable=True)
    google_refresh_token = Column(Text, nullable=True)
    google_token_expiry = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    event_types = relationship("EventType", back_populates="user", cascade="all, delete")
    availabilities = relationship("Availability", back_populates="user", cascade="all, delete")


class EventType(Base):
    __tablename__ = "event_types"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False)
    duration_minutes = Column(Integer, default=30)
    description = Column(Text, nullable=True)
    color = Column(String, default="#0069ff")
    is_active = Column(Boolean, default=True)
    location = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="event_types")
    bookings = relationship("Booking", back_populates="event_type", cascade="all, delete")


class Availability(Base):
    __tablename__ = "availability"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=Monday … 6=Sunday
    start_time = Column(String, nullable=False)    # "HH:MM"
    end_time = Column(String, nullable=False)      # "HH:MM"
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="availabilities")


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(Integer, primary_key=True, index=True)
    event_type_id = Column(Integer, ForeignKey("event_types.id"), nullable=False)
    invitee_name = Column(String, nullable=False)
    invitee_email = Column(String, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    google_event_id = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String, default="confirmed")   # confirmed | cancelled
    created_at = Column(DateTime, default=datetime.utcnow)

    event_type = relationship("EventType", back_populates="bookings")
