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
    user_from_token,
    validate_password,
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


class RecoveryCodeResponse(BaseModel):
    reset_token: str
    expires_in_minutes: int = 30


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
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authentication token")
    user = user_from_token(db, authorization.removeprefix("Bearer ").strip())
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")
    return user


def require_admin(user: UserAccount = Depends(current_user)) -> UserAccount:
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Computer admin privilege required")
    return user


def require_superadmin(user: UserAccount = Depends(current_user)) -> UserAccount:
    if user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin privilege required")
    return user


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
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    if payload.role == "superadmin" and _admin.role != "superadmin":
        raise HTTPException(status_code=403, detail="Only a superadmin can grant superadmin access")
    if not payload.username.strip() or not payload.display_name.strip():
        raise HTTPException(status_code=400, detail="Username and display name are required")
    try:
        validate_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
) -> ForgotPasswordResponse:
    return ForgotPasswordResponse(
        message="Contact your department administrator to verify your identity and obtain a recovery code. Enter that code below to reset your password.",
    )


@router.post("/auth/accounts/{user_id}/recovery-code")
def issue_recovery_code(user_id: UUID, actor: UserAccount = Depends(require_admin), db: Session = Depends(get_db)) -> RecoveryCodeResponse:
    user = db.get(UserAccount, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if user.active_status != "active":
        raise HTTPException(status_code=409, detail="Reactivate the account before issuing recovery")
    if user.role == "superadmin" and actor.role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin recovery requires a superadmin")
    return RecoveryCodeResponse(reset_token=create_reset_token(db, user))


@router.post("/auth/reset-password")
def reset_password_endpoint(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        changed = reset_password(db, payload.token, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not changed:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"status": "password_reset"}


@router.post("/auth/change-password")
def change_password_endpoint(
    payload: ChangePasswordRequest,
    user: UserAccount = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    try:
        changed = change_password(db, user, payload.current_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not changed:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    return {"status": "password_changed"}
