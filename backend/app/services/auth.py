import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import PasswordResetToken, UserAccount, UserSession

ROLES = {
    "hod": "Head of Department",
    "rota_board_member": "Rota board member",
    "computer_admin": "Computer admin",
    "superadmin": "Superadmin",
}
ADMIN_ROLES = {"computer_admin", "superadmin"}
WORKFLOW_PERMISSIONS = {"view_workflow", "account_self", "manage_leave", "manage_unit_postings",
                        "manage_scope", "generate_template", "assign_duties", "review_rota",
                        "request_exchange", "approve_exchange", "download_exports"}
ROLE_PERMISSIONS = {role: set(WORKFLOW_PERMISSIONS) for role in ROLES}
for role in ADMIN_ROLES:
    ROLE_PERMISSIONS[role].update({"manage_members", "configure_rules", "manage_groups", "manage_mappings",
                                   "import_members", "import_past_duties", "manage_accounts", "diagnostics"})
for role in {"hod", *ADMIN_ROLES}:
    ROLE_PERMISSIONS[role].add("manage_member_profiles")
for role in {"rota_board_member", "hod", "superadmin"}:
    ROLE_PERMISSIONS[role].add("publish_rota")
ROLE_PERMISSIONS["superadmin"].add("grant_superadmin")


def permissions_for_role(role: str) -> list[str]:
    return sorted(ROLE_PERMISSIONS.get(role, set()))


def validate_password(password: str) -> str:
    if len(password) < 8 or len(password) > 128:
        raise ValueError("Password must contain between 8 and 128 characters")
    if not password.strip():
        raise ValueError("Password cannot consist only of spaces")
    return password


def revoke_user_sessions(db: Session, user_id) -> None:
    now = datetime.utcnow()
    db.execute(update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None)).values(revoked_at=now))
    db.execute(update(PasswordResetToken).where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None)).values(used_at=now))


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
    if user is None or user.active_status != "active" or user.role not in ROLES:
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
    db.execute(update(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)).values(used_at=datetime.utcnow()))
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
    validate_password(new_password)
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
    revoke_user_sessions(db, reset.user_id)
    db.commit()
    return True


def change_password(db: Session, user: UserAccount, current_password: str, new_password: str) -> bool:
    validate_password(new_password)
    if not verify_secret(current_password, user.password_hash):
        return False
    user.password_hash = hash_secret(new_password)
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
