import hashlib
import hmac
import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

from .database import IntegrityErrors, database, lock_auth

router = APIRouter(prefix="/api/auth")
bearer = HTTPBearer(auto_error=False)


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=12, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize(cls, value):
        return value.lower()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ":" + digest


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if credentials:
        with database() as db:
            user = db.execute("SELECT users.id, users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?", (token_hash(credentials.credentials), time.time())).fetchone()
            if user:
                return dict(user)
    raise HTTPException(401, "ログインしてください。", headers={"WWW-Authenticate": "Bearer"})


User = Annotated[dict, Depends(current_user)]


def attempt_buckets(request, username, scope="login"):
    ip = request.client.host if request.client else "unknown"
    return [(hashlib.sha256(f"{scope}:{key}".encode()).hexdigest(), limit)
            for key, limit in [("ip:" + ip, 60), ("name:" + username, 10)]]


def throttle(request, username, scope="login"):
    # 試行回数はDBで管理し、ワーカーをまたいで制限する。転送ヘッダーは信用しない。
    now = time.time()
    blocked = False
    with database() as db:
        lock_auth(db)
        db.execute("DELETE FROM auth_attempts WHERE started_at<?", (now - 900,))
        for bucket, limit in attempt_buckets(request, username, scope):
            db.execute("INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=auth_attempts.count+1", (bucket, now))
            count = db.execute("SELECT count FROM auth_attempts WHERE bucket=?", (bucket,)).fetchone()["count"]
            blocked = blocked or count > limit
    if blocked:
        raise HTTPException(429, "試行回数が多いため、15分ほど待って再試行してください。")


def release_successful_login(request, username):
    # 成功した今回の試行だけを戻し、同時に発生した失敗の回数は消さない。
    with database() as db:
        lock_auth(db)
        for bucket, _ in attempt_buckets(request, username):
            db.execute("UPDATE auth_attempts SET count=count-1 WHERE bucket=? AND count>0", (bucket,))


def issue(user, response):
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (time.time(),))
        db.execute("INSERT INTO sessions VALUES (?,?,?)", (token_hash(token), user["id"], time.time() + 86400))
    response.headers["Cache-Control"] = "no-store"
    return {"token": token, "user": user, "expires_in": 86400}


@router.post("/register", status_code=201)
def register(data: Credentials, request: Request, response: Response):
    throttle(request, data.username, "register")
    hashed = password_hash(data.password)
    try:
        with database() as db:
            row = db.execute("INSERT INTO users (username,password_hash) VALUES (?,?) RETURNING id", (data.username, hashed)).fetchone()
            user = {"id": row["id"], "username": data.username}
    except IntegrityErrors:
        raise HTTPException(409, "そのユーザー名は使用できません。") from None
    return issue(user, response)


@router.post("/login")
def login(data: Credentials, request: Request, response: Response):
    throttle(request, data.username)
    with database() as db:
        row = db.execute("SELECT * FROM users WHERE username=?", (data.username,)).fetchone()
    stored = row["password_hash"] if row else password_hash("dummy", "00" * 16)
    valid = hmac.compare_digest(stored, password_hash(data.password, stored.split(":")[0]))
    if not row or not valid:
        raise HTTPException(401, "ユーザー名またはパスワードが違います。")
    release_successful_login(request, data.username)
    return issue({"id": row["id"], "username": row["username"]}, response)


@router.get("/me")
def me(user: User):
    return user


@router.post("/logout")
def logout(user: User, credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)]):
    with database() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(credentials.credentials),))
    return {"message": "ログアウトしました。"}
