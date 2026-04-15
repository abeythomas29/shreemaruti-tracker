from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    openai_api_key = Column(String, nullable=True)          # user's own key
    subscription_status = Column(String, default="free")    # free | active | canceled
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scans = relationship("Scan", back_populates="user", cascade="all, delete")


class Scan(Base):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    awb_number = Column(String, nullable=False, index=True)
    courier = Column(String, nullable=False, default="shreemaruti")
    image_filename = Column(String, nullable=True)
    current_status = Column(String, nullable=True)
    current_location = Column(String, nullable=True)
    is_delivered = Column(Boolean, default=False)
    delivery_date = Column(String, nullable=True)
    last_checked = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="scans")
    events = relationship("TrackingEvent", back_populates="scan", cascade="all, delete")


class PublicSearchQuota(Base):
    __tablename__ = "public_search_quota"

    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String, nullable=False, index=True)
    date = Column(String, nullable=False)          # YYYY-MM-DD
    count = Column(Integer, default=0)


class TrackingEvent(Base):
    __tablename__ = "tracking_events"

    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=False)
    status = Column(String, nullable=False)
    location = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    event_time = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    scan = relationship("Scan", back_populates="events")
