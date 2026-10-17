"""Login accounts, bearer-token sessions and password flows.

Auth model: ``POST /auth/sign-in`` returns an opaque random token; the client sends it as
``Authorization: Bearer <token>``. Only the SHA-256 hash of the token is stored
(``user_sessions``), sessions last 12 hours, and there is no server-side sign-out.

Dependencies exported for other routers:
- ``current_user``  - any active account (rota board member, computer admin, superadmin).
- ``require_admin`` - computer admin or superadmin.

SECURITY (handbook S2, S4): ``/auth/forgot-password`` returns the reset token directly in
the response, and ``/auth/seed-superadmin`` is unauthenticated and seeds a hard-coded
password. Both were development conveniences and must not stay in production.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import UserAccount
from app.services.auth import (
    ADMIN_ROLES,
    ROLES,
    authenticate,
    change_password,
    create_reset_token,
    create_session,
    hash_secret,
    reset_password,
    seed_superadmin,
    user_from_token,
)

router = APIRouter()


class UserRead(BaseModel):
    id: UUID
    username: str
    display_name: str
    email: str | None
    role: str
    role_label: str
    active_status: str


class AccountCreate(BaseModel):
    username: str
    display_name: str
    password: str
    email: str | None = None
    role: str = "rota_board_member"


class SignInRequest(BaseModel):
    username: str
    password: str


class SignInResponse(BaseModel):
    token: str
    user: UserRead


class ForgotPasswordRequest(BaseModel):
    username: str


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ProfileUpdateRequest(BaseModel):
    display_name: str
    email: str | None = None


def user_to_read(user: UserAccount) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        role=user.role,
        role_label=ROLES.get(user.role, user.role),
        active_status=user.active_status,
    )


def current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> UserAccount:
    """FastAPI dependency: resolve the ``Authorization: Bearer <token>`` header to an active account (401 otherwise)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token")
    user = user_from_token(db, authorization.removeprefix("Bearer ").strip())
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")
    return user


def require_admin(user: UserAccount = Depends(current_user)) -> UserAccount:
    """FastAPI dependency: like ``current_user`` but also requires computer admin or superadmin (403 otherwise)."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Computer admin privilege required")
    return user


# KNOWN ISSUE (handbook S4): unauthenticated; seeds `rotachief` with a hard-coded password
# if that username does not exist. Remove or protect before production use.
@router.post("/auth/seed-superadmin")
def seed_superadmin_endpoint(db: Session = Depends(get_db)) -> UserRead:
    return user_to_read(seed_superadmin(db))


@router.post("/auth/sign-in")
def sign_in(payload: SignInRequest, db: Session = Depends(get_db)) -> SignInResponse:
    user = authenticate(db, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token, _ = create_session(db, user)
    return SignInResponse(token=token, user=user_to_read(user))


@router.get("/auth/me")
def me(user: UserAccount = Depends(current_user)) -> UserRead:
    return user_to_read(user)


@router.put("/auth/me")
def update_me(
    payload: ProfileUpdateRequest,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> UserRead:
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required")
    user.display_name = display_name
    user.email = payload.email.strip() if payload.email and payload.email.strip() else None
    db.commit()
    db.refresh(user)
    return user_to_read(user)


@router.post("/auth/accounts")
def create_account(
    payload: AccountCreate,
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserRead:
    # KNOWN ISSUE (handbook S6/S7): any admin (including computer_admin) can create a
    # superadmin, and no password strength rule is applied here.
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    user = UserAccount(
        username=payload.username.strip(),
        display_name=payload.display_name.strip(),
        email=payload.email,
        role=payload.role,
        password_hash=hash_secret(payload.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc
    db.refresh(user)
    return user_to_read(user)


@router.get("/auth/accounts")
def list_accounts(
    _admin: UserAccount = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[UserRead]:
    return [user_to_read(user) for user in db.scalars(select(UserAccount).order_by(UserAccount.username))]


@router.post("/auth/forgot-password")
def forgot_password(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
) -> ForgotPasswordResponse:
    # KNOWN ISSUE (handbook S2, CRITICAL): the reset token is returned to the caller and the
    # login page auto-fills it, so anyone who knows a username can reset that password.
    # The token must be delivered out-of-band (email/SMS/admin) instead.
    user = db.scalar(select(UserAccount).where(UserAccount.username == payload.username.strip()))
    if user is None:
        return ForgotPasswordResponse(message="If the account exists, a reset token was created.")
    token = create_reset_token(db, user)
    return ForgotPasswordResponse(
        message="Reset token created. In production this should be delivered by email/SMS.",
        reset_token=token,
    )


@router.post("/auth/reset-password")
def reset_password_endpoint(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    if not reset_password(db, payload.token, payload.new_password):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"status": "password_reset"}


@router.post("/auth/change-password")
def change_password_endpoint(
    payload: ChangePasswordRequest,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if not change_password(db, user, payload.current_password, payload.new_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    return {"status": "password_changed"}
