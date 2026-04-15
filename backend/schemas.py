from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    subscription_status: str
    has_api_key: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UpdateAPIKey(BaseModel):
    api_key: str


class TrackingEventOut(BaseModel):
    id: int
    status: str
    location: Optional[str] = None
    description: Optional[str] = None
    event_time: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ScanOut(BaseModel):
    id: int
    awb_number: str
    courier: Optional[str] = "shreemaruti"
    current_status: Optional[str] = None
    current_location: Optional[str] = None
    is_delivered: bool
    delivery_date: Optional[str] = None
    last_checked: Optional[datetime] = None
    created_at: datetime
    events: List[TrackingEventOut] = []

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class CheckoutResponse(BaseModel):
    checkout_url: str


class ScanRequest(BaseModel):
    awb_number: Optional[str] = None   # manual override; if None, AI extracts from image
