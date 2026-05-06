import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PasswordResetToken, UserAccount, UserSession

ROLES = {
    "rota_board_member": "Rota board member",
    "computer_admin": "Computer admin",
    "superadmin": "Superadmin",
}
ADMIN_ROLES = {"computer_admin", "superadmin"}


def hash_secret(secret: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, 260_000)
    return "pbkdf2_sha256$260000$%s$%s" % (
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_secret(secret: str, hashed: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = hashed.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    salt = base64.b64decode(salt_b64)
    expected = base64.b64decode(digest_b64)
    actual = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, int(iterations))
    return hmac.compare_digest(actual, expected)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: UserAccount) -> tuple[str, UserSession]:
    token = secrets.token_urlsafe(32)
    session = UserSession(
        user=user,
        token_hash=token_hash(token),
        expires_at=datetime.utcnow() + timedelta(hours=12),
    )
    user.last_login_at = datetime.utcnow()
    db.add(session)
    db.commit()
    db.refresh(session)
    return token, session


def authenticate(db: Session, username: str, password: str) -> UserAccount | None:
    user = db.scalar(select(UserAccount).where(UserAccount.username == username.strip()))
    if user is None or user.active_status != "active":
        return None
    if not verify_secret(password, user.password_hash):
        return None
    return user


def user_from_token(db: Session, token: str) -> UserAccount | None:
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == token_hash(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.utcnow(),
        )
    )
    if session is None or session.user.active_status != "active":
        return None
    return session.user


def create_reset_token(db: Session, user: UserAccount) -> str:
    token = secrets.token_urlsafe(24)
    reset = PasswordResetToken(
        user=user,
        token_hash=token_hash(token),
        expires_at=datetime.utcnow() + timedelta(minutes=30),
    )
    db.add(reset)
    db.commit()
    return token


def reset_password(db: Session, token: str, new_password: str) -> bool:
    reset = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash(token),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > datetime.utcnow(),
        )
    )
    if reset is None:
        return False
    reset.user.password_hash = hash_secret(new_password)
    reset.used_at = datetime.utcnow()
    db.commit()
    return True


def seed_superadmin(db: Session) -> UserAccount:
    existing = db.scalar(select(UserAccount).where(UserAccount.username == "rotachief"))
    if existing is not None:
        return existing
    user = UserAccount(
        username="rotachief",
        display_name="Rota Chief",
        role="superadmin",
        password_hash=hash_secret("rotateam"),
        active_status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
