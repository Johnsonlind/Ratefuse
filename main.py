# ==========================================
# FastAPI 后端主应用
# ==========================================
import asyncio
import os
from dotenv import load_dotenv
import time
import ssl
from zoneinfo import ZoneInfo
from datetime import timezone
from typing import Optional, Any
from pydantic import BaseModel
import hashlib
import httpx
import logging
import mimetypes
from html import escape as html_escape, unescape as html_unescape

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _request_trace_id(request: Optional["Request"]) -> str:
    if not request:
        return "-"
    return (
        request.headers.get("x-request-id")
        or request.headers.get("cf-ray")
        or "-"
    )

def _log_favorite_api(
    request: Optional["Request"],
    endpoint: str,
    start_ts: float,
    list_count: int = 0,
    favorites_count: int = 0,
    payload_bytes: int = 0,
):
    elapsed_ms = int((time.perf_counter() - start_ts) * 1000)
    logger.info(
        f"[favorite_api] endpoint={endpoint} request_id={_request_trace_id(request)} "
        f"elapsed_ms={elapsed_ms} lists={list_count} favorites={favorites_count} bytes={payload_bytes}"
    )

from fastapi import FastAPI, HTTPException, Request, Depends, APIRouter, Response, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer, OAuth2
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
import bcrypt
from datetime import datetime, timedelta
from urllib.parse import quote, urlparse, urlunparse


def _effective_redis_url() -> str:
    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    pw = (os.getenv("REDIS_PASSWORD") or "").strip()
    if not pw:
        return url
    p = urlparse(url)
    if not p.netloc or "@" in p.netloc:
        return url
    enc = quote(pw, safe="")
    new_netloc = f":{enc}@{p.netloc}"
    return urlunparse((p.scheme, new_netloc, p.path, p.params, p.query, p.fragment))
from models import (
    SQLALCHEMY_DATABASE_URL,
    User,
    Favorite,
    FavoriteList,
    SessionLocal,
    PasswordReset,
    Follow,
    ChartEntry,
    PublicChartEntry,
    SchedulerStatus,
    MediaDetailAccessLog,
    Feedback,
    FeedbackMessage,
    FeedbackImage,
    FeedbackStatusEvent,
    Notification,
    MediaPlatformStatus,
    MediaPlatformStatusLog,
    TelegramFeedbackMapping,
)
from sqlalchemy.orm import Session, selectinload
from ratings import (
    douban_search_and_extract_rating,
    extract_rating_info,
    get_tmdb_info,
    RATING_STATUS,
    search_platform,
    create_rating_data,
    get_tmdb_http_client,
    is_platform_locked,
    update_platform_status_after_fetch,
)
from redis import asyncio as aioredis
import json
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
import secrets
import aiohttp
from fastapi.security.utils import get_authorization_scheme_param
from fastapi.openapi.models import OAuthFlows as OAuthFlowsModel
from sqlalchemy import func, or_, not_, and_, create_engine, case, text
from sqlalchemy.pool import QueuePool
from fastapi.middleware.gzip import GZipMiddleware
from browser_pool import browser_pool
import traceback
import fcntl
from sqlalchemy import desc
import re

# ==========================================
# 1. 配置和初始化
# ==========================================

REDIS_URL = _effective_redis_url()
CACHE_EXPIRE_TIME = 24 * 60 * 60
CHARTS_CACHE_EXPIRE = 2 * 60
redis = None

_local_cache = {}
_local_cache_lock = asyncio.Lock()

SECRET_KEY = os.getenv("SECRET_KEY", "")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
if not SECRET_KEY:
    logger.warning("SECRET_KEY 未设置：JWT 与重置密码链接依赖的签名将无法使用，请在 .env 中配置")
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
REMEMBER_ME_TOKEN_EXPIRE_DAYS = 30
TMDB_TOKEN = os.getenv("TMDB_TOKEN", "")
TRAKT_CLIENT_ID = os.getenv("TRAKT_CLIENT_ID", "")
TRAKT_BASE_URL = os.getenv("TRAKT_BASE_URL", "").rstrip("/")
TMDB_API_BASE_URL = os.getenv("TMDB_API_BASE_URL", "").rstrip("/")
TMDB_IMAGE_ORIGIN = os.getenv("TMDB_IMAGE_ORIGIN", "https://tmdb.ratefuse.cn").rstrip("/")

def tmdb_image_poster_url(poster_path: str, size: str = "w500") -> str:
    """TMDB poster_path → 镜像站完整图片 URL"""
    if not poster_path:
        return ""
    p = poster_path if poster_path.startswith("/") else f"/{poster_path}"
    return f"{TMDB_IMAGE_ORIGIN}/t/p/{size}{p}"

def normalize_chart_entry_poster(poster: str) -> str:
    """将裸 poster_path 规范为镜像站 URL"""
    if not poster:
        return ""
    if (
        poster.startswith("/tmdb-images/")
        or poster.startswith("/tmdb/")
        or poster.startswith("/api/")
        or poster.startswith("http")
        or "tmdb.ratefuse.cn" in poster
    ):
        return poster
    p = poster if poster.startswith("/") else f"/{poster}"
    return tmdb_image_poster_url(p, "w500")

FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173" if os.getenv("ENV") == "development" else "https://ratefuse.cn",
)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_CHAT_IDS = [
    int(x) for x in (os.getenv("TELEGRAM_ADMIN_CHAT_IDS") or "").split(",") if x.strip()
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://ratefuse.cn",
        "https://ratefuse.cn",
        "http://www.ratefuse.cn",
        "https://www.ratefuse.cn"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800
)

# ==========================================
# 2. 辅助类
# ==========================================

class OAuth2PasswordBearerOptional(OAuth2):
    def __init__(
        self,
        tokenUrl: str,
        scheme_name: Optional[str] = None,
        scopes: Optional[dict] = None,
        auto_error: bool = True,
    ):
        if not scopes:
            scopes = {}
        flows = OAuthFlowsModel(password={"tokenUrl": tokenUrl, "scopes": scopes})
        super().__init__(flows=flows, scheme_name=scheme_name, auto_error=auto_error)

    async def __call__(self, request: Request) -> Optional[str]:
        authorization: str = request.headers.get("Authorization")
        if not authorization:
            return None
            
        scheme, param = get_authorization_scheme_param(authorization)
        if not authorization or scheme.lower() != "bearer":
            return None
            
        return param

AUTH_COOKIE_NAME = "ratefuse_token"

def get_token_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("Authorization")
    if auth:
        scheme, param = get_authorization_scheme_param(auth)
        if scheme and scheme.lower() == "bearer" and param and param.strip() and param != "null":
            return param
    return request.cookies.get(AUTH_COOKIE_NAME)

def oauth2_scheme_with_cookie(request: Request) -> str:
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="无效的认证凭据",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token

def oauth2_scheme_optional_with_cookie(request: Request) -> Optional[str]:
    return get_token_from_request(request)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
oauth2_scheme_optional = OAuth2PasswordBearerOptional(tokenUrl="token", auto_error=False)

BCRYPT_MAX_PASSWORD_BYTES = 72

def _bcrypt_password_bytes(password: Optional[str]) -> bytes:
    if not password:
        return b""
    return password.encode("utf-8")[:BCRYPT_MAX_PASSWORD_BYTES]

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def verify_password(plain_password, hashed_password):
    if not hashed_password:
        return False
    secret = _bcrypt_password_bytes(plain_password)
    try:
        hp = (
            hashed_password.encode("utf-8")
            if isinstance(hashed_password, str)
            else hashed_password
        )
        return bcrypt.checkpw(secret, hp)
    except (ValueError, TypeError):
        return False

def get_password_hash(password):
    secret = _bcrypt_password_bytes(password)
    return bcrypt.hashpw(secret, bcrypt.gensalt(rounds=8)).decode("utf-8")

def create_access_token(data: dict, remember_me: bool = False):
    to_encode = data.copy()
    if remember_me:
        expire = datetime.utcnow() + timedelta(days=REMEMBER_ME_TOKEN_EXPIRE_DAYS)
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(
    request: Request,
    db: Session = Depends(get_db)
):
    token = oauth2_scheme_with_cookie(request)
    credentials_exception = HTTPException(
        status_code=401,
        detail="无效的认证凭据",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user_cache_key = f"user:by_email:{email}"
    cached_user = await get_cache(user_cache_key)
    if cached_user:
        try:
            user = db.query(User).filter(User.id == cached_user.get("id")).first()
            if user is not None:
                if getattr(user, "is_banned", False):
                    raise HTTPException(status_code=403, detail="账号已被封禁，请联系管理员")
                return user
        except Exception:
            pass

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    if getattr(user, "is_banned", False):
        raise HTTPException(status_code=403, detail="账号已被封禁，请联系管理员")
    await set_cache(user_cache_key, {"id": user.id}, expire=60)
    return user

async def get_current_user_optional(
    request: Request,
    db: Session = Depends(get_db)
) -> Optional[User]:
    token = oauth2_scheme_optional_with_cookie(request)
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            return None
            
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            return None
        if getattr(user, "is_banned", False):
            return None
        return user
    except JWTError:
        return None

async def get_cache(key: str):
    if redis:
        try:
            data = await redis.get(key)
            if data:
                data = json.loads(data)
                if isinstance(data, dict) and "status" in data:
                    if data.get("status") == RATING_STATUS["SUCCESSFUL"]:
                        return data
                    return None
                return data
            return None
        except Exception as e:
            logger.error(f"获取缓存出错: {e}")

    now = time.time()
    async with _local_cache_lock:
        hit = _local_cache.get(key)
        if not hit:
            return None
        expires_at, value = hit
        if expires_at <= now:
            _local_cache.pop(key, None)
            return None
        return value

async def set_cache(key: str, data: dict, expire: int = CACHE_EXPIRE_TIME):
    if redis:
        try:
            if isinstance(data, dict) and "status" in data:
                if data.get("status") == RATING_STATUS["SUCCESSFUL"]:
                    await redis.setex(key, expire, json.dumps(data))
            else:
                await redis.setex(key, expire, json.dumps(data))
        except Exception as e:
            logger.error(f"设置缓存出错: {e}")

    expires_at = time.time() + max(1, int(expire))
    async with _local_cache_lock:
        _local_cache[key] = (expires_at, data)

async def get_tmdb_info_cached(id: str, type: str, request: Request):
    cache_key = f"tmdb:info:{type}:{id}"
    cached = await get_cache(cache_key)
    if cached:
        return cached
    tmdb_info = await get_tmdb_info(id, type, request)
    if tmdb_info:
        await set_cache(cache_key, tmdb_info, expire=CACHE_EXPIRE_TIME)
    return tmdb_info

def generate_reset_token():
    return secrets.token_urlsafe(32)

def check_following_status(db: Session, follower_id: Optional[int], following_id: int) -> bool:
    if not follower_id:
        return False
    
    follow = db.query(Follow).filter(
        Follow.follower_id == follower_id,
        Follow.following_id == following_id
    ).first()
    
    return bool(follow)

def _serialize_notification(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "user_id": n.user_id,
        "type": n.type,
        "content": n.content,
        "link": n.link,
        "is_read": bool(n.is_read),
        "created_at": _to_shanghai_iso(n.created_at),
    }

def _create_notification(
    db: Session,
    user_id: int,
    type_: str,
    content: str,
    link: Optional[str] = None,
) -> Notification:
    n = Notification(
        user_id=user_id,
        type=type_,
        content=content,
        link=link,
        is_read=False,
        created_at=_now_utc_naive(),
    )
    db.add(n)
    return n

def _notify_followers(
    db: Session,
    actor_user_id: int,
    type_: str,
    content: str,
    link: Optional[str] = None,
) -> int:
    follower_rows = db.query(Follow.follower_id).filter(Follow.following_id == actor_user_id).all()
    created = 0
    for (fid,) in follower_rows:
        if not fid or fid == actor_user_id:
            continue
        _create_notification(db, user_id=int(fid), type_=type_, content=content, link=link)
        created += 1
    return created

def _notify_admins(
    db: Session,
    type_: str,
    content: str,
    link: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
) -> int:
    admin_rows = db.query(User.id).filter(User.is_admin == True).all()
    created = 0
    for (uid,) in admin_rows:
        if not uid:
            continue
        if exclude_user_id and int(uid) == int(exclude_user_id):
            continue
        _create_notification(db, user_id=int(uid), type_=type_, content=content, link=link)
        created += 1
    return created

def _avatar_url_or_none(user: Optional[User]) -> Optional[str]:
    if not user:
        return None
    avatar = getattr(user, "avatar", None)
    if not avatar:
        return None
    return f"/api/users/{user.id}/avatar"

@app.get("/api/users/{user_id}/avatar")
async def get_user_avatar(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    avatar = getattr(user, "avatar", None) if user else None
    if not avatar:
        raise HTTPException(status_code=404, detail="用户头像不存在")

    try:
        header, b64data = avatar.split(",", 1)
        mime_match = re.match(r"data:(.*?);base64", header)
        media_type = mime_match.group(1) if mime_match else "image/png"
        img_bytes = base64.b64decode(b64data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"头像数据格式错误: {str(e)}")

    return Response(
        content=img_bytes,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )

# ==========================================
# 3. 用户认证
# ==========================================

@app.post("/auth/register")
async def register(
    request: Request,
    db: Session = Depends(get_db)
):
    data = await request.json()
    email = data.get("email")
    username = data.get("username")
    password = data.get("password")
    
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=400,
            detail="该邮箱已被注册"
        )
    
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(
            status_code=400,
            detail="该用户名已被使用"
        )
    
    hashed_password = get_password_hash(password)
    user = User(
        email=email,
        username=username,
        hashed_password=hashed_password
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    access_token = create_access_token(
        data={"sub": user.email},
        remember_me=False
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username
        }
    }

def _login_verify_sync(email: str, password: str) -> tuple[Optional[User], Optional[str]]:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            return None, "此邮箱未注册"
        if getattr(user, "is_banned", False):
            return None, "账号已被封禁，请联系管理员"
        if not verify_password(password, user.hashed_password):
            return None, "邮箱或密码错误"
        return user, None
    finally:
        db.close()

@app.post("/auth/login")
async def login(request: Request):
    login_start = time.time()
    logger.info("登录请求开始处理")
    try:
        data = await request.json()
        email = data.get("email")
        password = data.get("password")
        remember_me = data.get("remember_me", False)
        
        user, err = await asyncio.to_thread(_login_verify_sync, email or "", password or "")
        if err:
            raise HTTPException(status_code=401, detail=err)
        
        access_token = create_access_token(
            data={"sub": user.email},
            remember_me=remember_me
        )
        
        elapsed = round(time.time() - login_start, 3)
        logger.info(f"登录成功 email={email} 耗时={elapsed}s remember_me={remember_me}")
        
        user_payload = {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "avatar": _avatar_url_or_none(user),
            "is_admin": getattr(user, "is_admin", False),
        }
        
        if remember_me:
            max_age = REMEMBER_ME_TOKEN_EXPIRE_DAYS * 24 * 3600
            is_secure = os.getenv("ENV") != "development"
            response = JSONResponse(content={
                "user": user_payload,
                "remember_me": True,
            })
            response.set_cookie(
                key=AUTH_COOKIE_NAME,
                value=access_token,
                max_age=max_age,
                httponly=True,
                samesite="lax",
                secure=is_secure,
                path="/",
            )
            return response
        else:
            return {
                "access_token": access_token,
                "token_type": "bearer",
                "user": user_payload,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"登录过程出错: {str(e)}")
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"登录失败: {str(e)}"
        )

@app.post("/auth/logout")
async def logout(response: Response):
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return response

@app.post("/auth/forgot-password")
async def forgot_password(
    request: Request,
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        email = data.get("email")
        
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(
                status_code=404,
                detail="未找到该邮箱对应的用户"
            )
        
        token = generate_reset_token()
        expires_at = datetime.utcnow() + timedelta(hours=24)
        
        reset_record = PasswordReset(
            email=email,
            token=token,
            expires_at=expires_at
        )
        db.add(reset_record)
        db.commit()
        
        reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "465"))
        sender_email = os.getenv("SMTP_USER", "")
        app_password = os.getenv("SMTP_PASSWORD", "")
        mail_from = os.getenv("SMTP_FROM", f"RateFuse <{sender_email}>" if sender_email else "")

        if not sender_email or not app_password:
            raise HTTPException(
                status_code=503,
                detail="邮件服务未配置：请在 .env 中设置 SMTP_USER 与 SMTP_PASSWORD",
            )

        message = MIMEMultipart()
        message["From"] = mail_from or f"RateFuse <{sender_email}>"
        message["To"] = email
        message["Subject"] = "RateFuse - 重置密码"
        
        body = f"""
        <html>
          <body>
            <h2>重置您的 RateFuse 密码</h2>
            <p>您好！</p>
            <p>我们收到了重置您 RateFuse 账户密码的请求。请点击下面的链接重置密码：</p>
            <p><a href="{reset_link}">重置密码</a></p>
            <p>如果您没有请求重置密码，请忽略此邮件。</p>
            <p>此链接将在 24 小时后失效。</p>
            <br>
            <p>RateFuse 团队</p>
          </body>
        </html>
        """
        
        message.attach(MIMEText(body, "html"))
        
        max_retries = 3
        retry_count = 0

        while retry_count < max_retries:
            try:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context) as server:
                    server.login(sender_email, app_password)
                    text = message.as_string()
                    server.sendmail(sender_email, email, text)
                    return {"message": "重置密码邮件已发送"}
            except Exception as e:
                retry_count += 1
                if retry_count == max_retries:
                    raise HTTPException(
                        status_code=500,
                        detail=f"发送邮件失败: {str(e)}"
                    )
                time.sleep(2)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"处理请求失败: {str(e)}"
        )

@app.post("/auth/reset-password")
async def reset_password(
    request: Request,
    db: Session = Depends(get_db)
):
    data = await request.json()
    token = data.get("token")
    new_password = data.get("password")
    
    reset_record = db.query(PasswordReset).filter(
        PasswordReset.token == token,
        PasswordReset.used == False,
        PasswordReset.expires_at > datetime.utcnow()
    ).first()
    
    if not reset_record:
        raise HTTPException(
            status_code=400,
            detail="无效或已过期的重置链接"
        )
    
    user = db.query(User).filter(User.email == reset_record.email).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="未找到用户"
        )
    
    user.hashed_password = get_password_hash(new_password)
    reset_record.used = True
    db.commit()
    
    return {"message": "密码重置成功"}

@app.get("/user/me")
async def read_user_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username
    }

@app.get("/api/user/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
        "avatar": _avatar_url_or_none(current_user),
        "is_admin": current_user.is_admin
    }

@app.put("/api/user/douban-cookie")
async def update_douban_cookie(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        cookie = data.get("cookie", "").strip()
        
        if cookie:
            current_user.douban_cookie = cookie
        else:
            current_user.douban_cookie = None
        
        db.commit()
        
        return {
            "message": "豆瓣Cookie更新成功" if cookie else "豆瓣Cookie已清除",
            "has_cookie": bool(cookie)
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新豆瓣Cookie时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/user/douban-cookie")
async def get_douban_cookie(
    current_user: User = Depends(get_current_user)
):
    return {
        "has_cookie": bool(current_user.douban_cookie)
    }

@app.put("/api/user/profile")
async def update_profile(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        if data.get("avatar"):
            if not data["avatar"].startswith('data:image/'):
                raise HTTPException(
                    status_code=400,
                    detail="无效的图片格式"
                )
            avatar_data = data["avatar"].split(',')[1]
            if len(avatar_data) > 2 * 1024 * 1024:
                raise HTTPException(
                    status_code=400,
                    detail="图片大小不能超过 2MB"
                )
            current_user.avatar = data["avatar"]
        
        if data.get("username"):
            existing_user = db.query(User).filter(
                User.username == data["username"],
                User.id != current_user.id
            ).first()
            if existing_user:
                raise HTTPException(
                    status_code=400,
                    detail="该用户名已被使用"
                )
            current_user.username = data["username"]
        
        if data.get("password"):
            current_user.hashed_password = get_password_hash(data["password"])
        
        db.commit()
        
        return {
            "message": "个人资料更新成功",
            "user": {
                "id": current_user.id,
                "email": current_user.email,
                "username": current_user.username,
                "avatar": _avatar_url_or_none(current_user)
            }
        }
    except Exception as e:
        db.rollback()
        logger.error(f"更新个人资料时出错: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 4. 收藏
# ==========================================

@app.post("/api/favorites")
async def add_favorite(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        required_fields = ["media_id", "media_type", "title", "poster", "list_id"]
        for field in required_fields:
            if field not in data:
                raise HTTPException(
                    status_code=400,
                    detail=f"缺少必要字段: {field}"
                )
        
        favorite_list = db.query(FavoriteList).filter(
            FavoriteList.id == data["list_id"],
            FavoriteList.user_id == current_user.id
        ).first()
        
        if not favorite_list:
            raise HTTPException(
                status_code=404,
                detail="收藏列表不存在或无权限访问"
            )
        
        max_sort_order = db.query(func.max(Favorite.sort_order)).filter(
            Favorite.list_id == data["list_id"]
        ).scalar()
        
        favorite = Favorite(
            user_id=current_user.id,
            list_id=data["list_id"],
            media_id=data["media_id"],
            media_type=data["media_type"],
            title=data["title"],
            poster=data["poster"],
            year=data.get("year", ""),
            note=data.get("note"),
            overview=data.get("overview", ""),
            sort_order=(max_sort_order + 1) if max_sort_order is not None else 0
        )
        
        db.add(favorite)
        list_name = (favorite_list.name or "").strip() or "列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_update",
            content=f"你关注的 {current_user.username} 更新了列表《{list_name}》",
            link=f"/favorite-lists/{favorite_list.id}",
        )
        db.commit()
        db.refresh(favorite)
        
        return {
            "message": "收藏成功",
            "favorite": {
                "id": favorite.id,
                "media_id": favorite.media_id,
                "media_type": favorite.media_type,
                "title": favorite.title,
                "poster": favorite.poster,
                "year": favorite.year,
                "note": favorite.note,
                "overview": favorite.overview
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"添加收藏失败: {str(e)}"
        )

@app.get("/api/favorites")
async def get_favorites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        favorites = db.query(Favorite).filter(
            Favorite.user_id == current_user.id
        ).all()
        
        return [{
            "id": fav.id,
            "media_id": fav.media_id,
            "media_type": fav.media_type,
            "title": fav.title,
            "poster": fav.poster,
            "year": fav.year,
            "overview": fav.overview,
            "note": fav.note
        } for fav in favorites]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取收藏失败: {str(e)}"
        )

@app.delete("/api/favorites/{favorite_id}")
async def delete_favorite(
    favorite_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        favorite = db.query(Favorite).filter(
            Favorite.id == favorite_id,
            Favorite.user_id == current_user.id
        ).first()
        
        if not favorite:
            raise HTTPException(
                status_code=404,
                detail="收藏不存在或无权限删除"
            )

        favorite_list = db.query(FavoriteList).filter(FavoriteList.id == favorite.list_id).first()
        list_name = ((favorite_list.name if favorite_list else "") or "").strip() or "列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_update",
            content=f"你关注的 {current_user.username} 更新了列表《{list_name}》",
            link=f"/favorite-lists/{favorite.list_id}",
        )
        db.delete(favorite)
        db.commit()
        
        return {"message": "收藏删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"删除收藏失败: {str(e)}"
        )

@app.put("/api/favorites/{favorite_id}")
async def update_favorite(
    favorite_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        favorite = db.query(Favorite).filter(
            Favorite.id == favorite_id,
            Favorite.user_id == current_user.id
        ).first()
        
        if not favorite:
            raise HTTPException(
                status_code=404,
                detail="收藏不存在或无权限修改"
            )
        
        if "note" in data:
            favorite.note = data["note"]

        favorite_list = db.query(FavoriteList).filter(FavoriteList.id == favorite.list_id).first()
        list_name = ((favorite_list.name if favorite_list else "") or "").strip() or "列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_update",
            content=f"你关注的 {current_user.username} 更新了列表《{list_name}》",
            link=f"/favorite-lists/{favorite.list_id}",
        )
        db.commit()
        db.refresh(favorite)
        
        return {
            "id": favorite.id,
            "media_id": favorite.media_id,
            "media_type": favorite.media_type,
            "title": favorite.title,
            "poster": favorite.poster,
            "year": favorite.year,
            "overview": favorite.overview,
            "note": favorite.note
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"更新收藏失败: {str(e)}"
        )

@app.get("/api/favorite-lists")
async def get_favorite_lists(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    start_ts = time.perf_counter()
    try:
        lists = (
            db.query(FavoriteList)
            .options(selectinload(FavoriteList.favorites))
            .filter(FavoriteList.user_id == current_user.id)
            .all()
        )

        original_list_ids = {lst.original_list_id for lst in lists if lst.original_list_id}
        original_lists_map = {}
        original_creators_map = {}

        if original_list_ids:
            original_lists = (
                db.query(FavoriteList)
                .options(selectinload(FavoriteList.user))
                .filter(FavoriteList.id.in_(original_list_ids))
                .all()
            )
            for ol in original_lists:
                original_lists_map[ol.id] = ol
                if ol.user:
                    original_creators_map[ol.id] = {
                        "id": ol.user.id,
                        "username": ol.user.username,
                        "avatar": _avatar_url_or_none(ol.user),
                    }

        creator = {
            "id": current_user.id,
            "username": current_user.username,
            "avatar": _avatar_url_or_none(current_user),
        }

        result = []
        for lst in lists:
            original_creator = original_creators_map.get(lst.original_list_id)

            favorites = sorted(
                lst.favorites or [],
                key=lambda fav: (
                    fav.sort_order is None,
                    fav.sort_order if fav.sort_order is not None else 0,
                    fav.id,
                ),
            )

            result.append(
                {
                    "id": lst.id,
                    "name": lst.name,
                    "description": lst.description,
                    "is_public": lst.is_public,
                    "created_at": _to_shanghai_iso(lst.created_at),
                    "original_list_id": lst.original_list_id,
                    "original_creator": original_creator,
                    "creator": creator,
                    "favorites": [
                        {
                            "id": fav.id,
                            "media_id": fav.media_id,
                            "media_type": fav.media_type,
                            "title": fav.title,
                            "poster": fav.poster,
                            "year": fav.year,
                            "overview": fav.overview,
                            "note": fav.note,
                            "sort_order": fav.sort_order,
                        }
                        for fav in favorites
                    ],
                }
            )

        favorites_count = sum(len(item.get("favorites") or []) for item in result)
        payload_bytes = len(json.dumps(result, ensure_ascii=False))
        _log_favorite_api(
            request=request,
            endpoint="/api/favorite-lists",
            start_ts=start_ts,
            list_count=len(result),
            favorites_count=favorites_count,
            payload_bytes=payload_bytes,
        )
        return result
    except Exception as e:
        logger.error(f"获取收藏列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取收藏列表失败: {str(e)}")

@app.get("/api/favorite-lists/light")
async def get_favorite_lists_light(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    start_ts = time.perf_counter()
    try:
        lists = (
            db.query(FavoriteList)
            .options(selectinload(FavoriteList.favorites))
            .filter(FavoriteList.user_id == current_user.id)
            .all()
        )

        original_list_ids = {lst.original_list_id for lst in lists if lst.original_list_id}
        original_creators_map = {}

        if original_list_ids:
            original_lists = (
                db.query(FavoriteList)
                .options(selectinload(FavoriteList.user))
                .filter(FavoriteList.id.in_(original_list_ids))
                .all()
            )
            for ol in original_lists:
                if ol.user:
                    original_creators_map[ol.id] = {
                        "id": ol.user.id,
                        "username": ol.user.username,
                        "avatar": _avatar_url_or_none(ol.user),
                    }

        creator = {
            "id": current_user.id,
            "username": current_user.username,
            "avatar": _avatar_url_or_none(current_user),
        }

        result = []
        for lst in lists:
            original_creator = original_creators_map.get(lst.original_list_id)
            favorites = sorted(
                lst.favorites or [],
                key=lambda fav: (
                    fav.sort_order is None,
                    fav.sort_order if fav.sort_order is not None else 0,
                    fav.id,
                ),
            )

            result.append(
                {
                    "id": lst.id,
                    "name": lst.name,
                    "description": lst.description,
                    "is_public": lst.is_public,
                    "created_at": _to_shanghai_iso(lst.created_at),
                    "original_list_id": lst.original_list_id,
                    "original_creator": original_creator,
                    "creator": creator,
                    "favorites": [
                        {
                            "id": fav.id,
                            "media_id": fav.media_id,
                            "media_type": fav.media_type,
                            "title": fav.title,
                            "poster": fav.poster,
                            "sort_order": fav.sort_order,
                        }
                        for fav in favorites
                    ],
                }
            )

        favorites_count = sum(len(item.get("favorites") or []) for item in result)
        payload_bytes = len(json.dumps(result, ensure_ascii=False))
        _log_favorite_api(
            request=request,
            endpoint="/api/favorite-lists/light",
            start_ts=start_ts,
            list_count=len(result),
            favorites_count=favorites_count,
            payload_bytes=payload_bytes,
        )
        return result
    except Exception as e:
        logger.error(f"获取轻量收藏列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取轻量收藏列表失败: {str(e)}")

@app.post("/api/favorite-lists")
async def create_favorite_list(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        if not data.get("name"):
            raise HTTPException(
                status_code=400,
                detail="列表名称不能为空"
            )
        
        existing_list = db.query(FavoriteList).filter(
            FavoriteList.user_id == current_user.id,
            FavoriteList.name == data["name"]
        ).first()
        
        if existing_list:
            raise HTTPException(
                status_code=400,
                detail="已存在同名收藏列表"
            )
        
        new_list = FavoriteList(
            user_id=current_user.id,
            name=data["name"],
            description=data.get("description"),
            is_public=data.get("is_public", False)
        )
        
        db.add(new_list)
        db.flush()

        list_name = (new_list.name or "").strip() or "新列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_new_list",
            content=f"你关注的 {current_user.username} 创建了新列表《{list_name}》",
            link=f"/favorite-lists/{new_list.id}",
        )
        db.commit()
        db.refresh(new_list)
        
        return {
            "id": new_list.id,
            "name": new_list.name,
            "description": new_list.description,
            "is_public": new_list.is_public,
            "created_at": _to_shanghai_iso(new_list.created_at),
            "favorites": []
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"创建收藏列表失败: {str(e)}"
        )

@app.get("/api/favorite-lists/{list_id}")
async def get_favorite_list(
    request: Request,
    list_id: int,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    start_ts = time.perf_counter()
    list_data = (
        db.query(FavoriteList)
        .options(
            selectinload(FavoriteList.favorites),
            selectinload(FavoriteList.user),
        )
        .filter(FavoriteList.id == list_id)
        .first()
    )
    if not list_data:
        raise HTTPException(status_code=404, detail="列表不存在")

    favorites = sorted(
        list_data.favorites or [],
        key=lambda fav: (
            fav.sort_order is None,
            fav.sort_order if fav.sort_order is not None else 0,
            fav.id,
        ),
    )

    response_data = {
        "id": list_data.id,
        "name": list_data.name,
        "description": list_data.description,
        "is_public": list_data.is_public,
        "user_id": list_data.user_id,
        "original_list_id": list_data.original_list_id,
        "favorites": [
            {
                "id": f.id,
                "media_id": f.media_id,
                "media_type": f.media_type,
                "title": f.title,
                "poster": f.poster,
                "year": f.year,
                "overview": f.overview,
                "note": f.note,
                "sort_order": f.sort_order
            }
            for f in favorites
        ]
    }

    creator = list_data.user
    if not creator:
        raise HTTPException(status_code=404, detail="列表创建者不存在")
    is_following_creator = False
    
    if current_user:
        follow = db.query(Follow).filter(
            Follow.follower_id == current_user.id,
            Follow.following_id == creator.id
        ).first()
        is_following_creator = follow is not None

    response_data["creator"] = {
        "id": creator.id,
        "username": creator.username,
        "avatar": _avatar_url_or_none(creator),
        "is_following": is_following_creator
    }

    if list_data.original_list_id:
        original_list = (
            db.query(FavoriteList)
            .options(selectinload(FavoriteList.user))
            .filter(FavoriteList.id == list_data.original_list_id)
            .first()
        )
        if original_list:
            original_creator = original_list.user
            if not original_creator:
                return response_data
            
            is_following_original = False
            if current_user:
                is_following_original = db.query(Follow).filter(
                    Follow.follower_id == current_user.id,
                    Follow.following_id == original_creator.id
                ).first() is not None
            
            response_data["original_creator"] = {
                "id": original_creator.id,
                "username": original_creator.username,
                "avatar": _avatar_url_or_none(original_creator),
                "is_following": is_following_original
            }

    favorites_count = len(response_data.get("favorites") or [])
    payload_bytes = len(json.dumps(response_data, ensure_ascii=False))
    _log_favorite_api(
        request=request,
        endpoint="/api/favorite-lists/{list_id}",
        start_ts=start_ts,
        list_count=1,
        favorites_count=favorites_count,
        payload_bytes=payload_bytes,
    )
    return response_data

@app.put("/api/favorite-lists/{list_id}")
async def update_favorite_list(
    list_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        favorite_list = db.query(FavoriteList).filter(
            FavoriteList.id == list_id,
            FavoriteList.user_id == current_user.id
        ).first()
        
        if not favorite_list:
            raise HTTPException(
                status_code=404,
                detail="收藏列表不存在或无权限修改"
            )
        
        if data.get("name") and data["name"] != favorite_list.name:
            existing_list = db.query(FavoriteList).filter(
                FavoriteList.user_id == current_user.id,
                FavoriteList.name == data["name"],
                FavoriteList.id != list_id
            ).first()
            
            if existing_list:
                raise HTTPException(
                    status_code=400,
                    detail="已存在同名收藏列表"
                )
            
            favorite_list.name = data["name"]
        
        if "description" in data:
            favorite_list.description = data["description"]
        
        if "is_public" in data:
            favorite_list.is_public = data["is_public"]

        list_name = (favorite_list.name or "").strip() or "列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_update",
            content=f"你关注的 {current_user.username} 更新了列表《{list_name}》",
            link=f"/favorite-lists/{favorite_list.id}",
        )
        db.commit()
        db.refresh(favorite_list)
        
        return {
            "id": favorite_list.id,
            "name": favorite_list.name,
            "description": favorite_list.description,
            "is_public": favorite_list.is_public,
            "user_id": favorite_list.user_id,
            "created_at": _to_shanghai_iso(favorite_list.created_at),
            "favorites": [{
                "id": fav.id,
                "media_id": fav.media_id,
                "media_type": fav.media_type,
                "title": fav.title,
                "poster": fav.poster,
                "year": fav.year,
                "overview":fav.overview,
                "note": fav.note
            } for fav in favorite_list.favorites]
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"更新收藏列表失败: {str(e)}"
        )

@app.delete("/api/favorite-lists/{list_id}")
async def delete_favorite_list(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        favorite_list = db.query(FavoriteList).filter(
            FavoriteList.id == list_id,
            FavoriteList.user_id == current_user.id
        ).first()
        
        if not favorite_list:
            raise HTTPException(
                status_code=404,
                detail="收藏列表不存在或无权限删除"
            )
        
        db.delete(favorite_list)
        db.commit()
        
        return {"message": "收藏列表删除成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"删除收藏列表失败: {str(e)}"
        )

@app.post("/api/favorite-lists/{list_id}/collect")
async def collect_favorite_list(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        source_list = db.query(FavoriteList).filter(
            FavoriteList.id == list_id
        ).first()
        
        if not source_list:
            raise HTTPException(
                status_code=404,
                detail="收藏列表不存在"
            )
            
        if not source_list.is_public:
            raise HTTPException(
                status_code=403,
                detail="该列表不是公开列表"
            )
            
        new_list = FavoriteList(
            user_id=current_user.id,
            name=f"{source_list.name} (收藏)",
            description=source_list.description,
            is_public=False,
            original_list_id=list_id
        )
        
        db.add(new_list)
        db.commit()
        db.refresh(new_list)
        
        for fav in source_list.favorites:
            new_favorite = Favorite(
                user_id=current_user.id,
                list_id=new_list.id,
                media_id=fav.media_id,
                media_type=fav.media_type,
                title=fav.title,
                poster=fav.poster,
                year=fav.year,
                overview=fav.overview
            )
            db.add(new_favorite)
            
        db.commit()
        
        return {"message": "收藏列表成功", "list_id": new_list.id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"收藏列表失败: {str(e)}"
        )

@app.put("/api/favorite-lists/{list_id}/reorder")
async def reorder_favorites(
    list_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        favorite_orders = data.get('favorite_ids', [])
        
        favorite_list = db.query(FavoriteList).filter(
            FavoriteList.id == list_id,
            FavoriteList.user_id == current_user.id
        ).first()
        
        if not favorite_list:
            raise HTTPException(status_code=404, detail="收藏列表不存在或无权限")
        
        for item in favorite_orders:
            favorite = db.query(Favorite).filter(
                Favorite.id == item['id'],
                Favorite.list_id == list_id
            ).first()
            
            if favorite:
                favorite.sort_order = item['sort_order']

        list_name = (favorite_list.name or "").strip() or "列表"
        _notify_followers(
            db,
            actor_user_id=current_user.id,
            type_="follow_user_update",
            content=f"你关注的 {current_user.username} 更新了列表《{list_name}》",
            link=f"/favorite-lists/{favorite_list.id}",
        )
        db.commit()
        
        updated_favorites = db.query(Favorite).filter(
            Favorite.list_id == list_id
        ).order_by(
            Favorite.sort_order.is_(None),
            Favorite.sort_order,
            Favorite.id
        ).all()
        
        return {
            "message": "排序更新成功",
            "favorites": [{
                "id": f.id,
                "media_id": f.media_id,
                "media_type": f.media_type,
                "title": f.title,
                "poster": f.poster,
                "year": f.year,
                "overview": f.overview,
                "note": f.note,
                "sort_order": f.sort_order
            } for f in updated_favorites]
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"更新排序失败: {str(e)}")

@app.delete("/api/favorite-lists/{list_id}/uncollect")
async def uncollect_favorite_list(
    list_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        collected_list = db.query(FavoriteList).filter(
            FavoriteList.user_id == current_user.id,
            FavoriteList.original_list_id == list_id
        ).first()
        
        if not collected_list:
            raise HTTPException(
                status_code=404,
                detail="未找到已收藏的列表"
            )

        db.delete(collected_list)
        db.commit()
        
        return {"message": "取消收藏成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"取消收藏失败: {str(e)}"
        )
    
# ==========================================
# 5. 用户关系
# ==========================================

@app.get("/api/users/search")
async def search_users(
    q: str = "",
    limit: int = 20,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (q or "").strip()
    limit = max(1, min(int(limit), 50))
    offset = max(0, int(offset))

    if not q:
        return {"list": [], "total": 0}

    q_lower = q.lower()
    like_any = f"%{q_lower}%"
    like_prefix = f"{q_lower}%"

    base = db.query(User).filter(
        User.id != current_user.id,
        func.lower(User.username).like(like_any),
    )

    if hasattr(User, "is_banned"):
        base = base.filter(getattr(User, "is_banned") == False)

    total = base.with_entities(func.count(User.id)).scalar() or 0

    rows = (
        base.outerjoin(
            Follow,
            and_(
                Follow.follower_id == current_user.id,
                Follow.following_id == User.id,
            ),
        )
        .with_entities(User, Follow.id.label("follow_id"))
        .order_by(
            case((func.lower(User.username).like(like_prefix), 0), else_=1),
            func.length(User.username),
            func.lower(User.username),
            User.id,
        )
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "list": [
            {
                "id": u.id,
                "username": u.username,
                "avatar": _avatar_url_or_none(u),
                "is_following": follow_id is not None,
            }
            for (u, follow_id) in rows
        ],
        "total": int(total),
    }

@app.get("/api/admin/users")
async def admin_list_users(
    q: str = "",
    banned: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    q = (q or "").strip()
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))

    base = db.query(User)
    if q:
        like_prefix = f"{q}%"
        base = base.filter(User.username.like(like_prefix))

    if banned:
        banned = banned.strip().lower()
        if banned == "banned":
            base = base.filter(getattr(User, "is_banned") == True)
        elif banned == "normal":
            base = base.filter((getattr(User, "is_banned") == False) | (getattr(User, "is_banned") == None))

    total = base.with_entities(func.count(User.id)).scalar() or 0

    rows = (
        base.order_by(User.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "list": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "avatar": _avatar_url_or_none(u),
                "is_admin": getattr(u, "is_admin", False),
                "is_banned": getattr(u, "is_banned", False),
                "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
            }
            for u in rows
        ],
        "total": int(total),
    }

@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    if getattr(user, "is_admin", False):
        raise HTTPException(status_code=400, detail="不能删除管理员账号")

    db.delete(user)
    db.commit()
    return {"ok": True}

@app.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="不能封禁自己")
    if getattr(user, "is_admin", False):
        raise HTTPException(status_code=400, detail="不能封禁管理员账号")

    if hasattr(user, "is_banned"):
        user.is_banned = True
        db.add(user)
        db.commit()
    return {"ok": True}

@app.post("/api/admin/users/{user_id}/unban")
async def admin_unban_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if hasattr(user, "is_banned"):
        user.is_banned = False
        db.add(user)
        db.commit()
    return {"ok": True}

@app.get("/api/users/{user_id}")
async def get_user_info(
    user_id: int,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    try:
        user = db.query(User).filter(User.id == user_id).first()
        
        if not user:
            raise HTTPException(
                status_code=404,
                detail="用户不存在"
            )
            
        is_following = False
        if current_user:
            follow = db.query(Follow).filter(
                Follow.follower_id == current_user.id,
                Follow.following_id == user_id
            ).first()
            
            is_following = follow is not None
        
        return {
            "id": user.id,
            "username": user.username,
            "avatar": _avatar_url_or_none(user),
            "email": user.email if current_user and current_user.id == user_id else None,
            "is_following": is_following
        }
    except Exception as e:
        print(f"获取用户信息失败: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"获取用户信息失败: {str(e)}"
        )

@app.get("/api/users/{user_id}/favorite-lists")
async def get_user_favorite_lists(
    user_id: int,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    try:
        query = (
            db.query(FavoriteList)
            .options(selectinload(FavoriteList.favorites))
            .filter(FavoriteList.user_id == user_id)
        )

        if not current_user or current_user.id != user_id:
            query = query.filter(FavoriteList.is_public == True)

        lists = query.all()
        list_ids = [lst.id for lst in lists]
        collected_ids = set()
        if current_user and list_ids:
            collected_ids = {
                row[0]
                for row in db.query(FavoriteList.original_list_id)
                .filter(
                    FavoriteList.user_id == current_user.id,
                    FavoriteList.original_list_id.in_(list_ids),
                )
                .all()
                if row[0] is not None
            }

        result = []
        for list_item in lists:
            favorites = sorted(
                list_item.favorites or [],
                key=lambda fav: (
                    fav.sort_order is None,
                    fav.sort_order if fav.sort_order is not None else 0,
                    fav.id,
                ),
            )

            result.append({
                "id": list_item.id,
                "name": list_item.name,
                "description": list_item.description,
                "is_public": list_item.is_public,
                "is_collected": list_item.id in collected_ids,
                "created_at": _to_shanghai_iso(list_item.created_at),
                "favorites": [{
                    "id": fav.id,
                    "media_id": fav.media_id,
                    "media_type": fav.media_type,
                    "title": fav.title,
                    "poster": fav.poster,
                    "year": fav.year,
                    "overview": fav.overview,
                    "note": fav.note,
                    "sort_order": fav.sort_order
                } for fav in favorites]
            })

        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取用户收藏列表失败: {str(e)}"
        )

@app.get("/api/users/{user_id}/favorite-lists/light")
async def get_user_favorite_lists_light(
    request: Request,
    user_id: int,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    start_ts = time.perf_counter()
    try:
        query = (
            db.query(FavoriteList)
            .options(selectinload(FavoriteList.favorites))
            .filter(FavoriteList.user_id == user_id)
        )

        if not current_user or current_user.id != user_id:
            query = query.filter(FavoriteList.is_public == True)

        lists = query.all()
        list_ids = [lst.id for lst in lists]
        collected_ids = set()
        if current_user and list_ids:
            collected_ids = {
                row[0]
                for row in db.query(FavoriteList.original_list_id)
                .filter(
                    FavoriteList.user_id == current_user.id,
                    FavoriteList.original_list_id.in_(list_ids),
                )
                .all()
                if row[0] is not None
            }

        result = []
        for list_item in lists:
            favorites = sorted(
                list_item.favorites or [],
                key=lambda fav: (
                    fav.sort_order is None,
                    fav.sort_order if fav.sort_order is not None else 0,
                    fav.id,
                ),
            )

            result.append({
                "id": list_item.id,
                "name": list_item.name,
                "description": list_item.description,
                "is_public": list_item.is_public,
                "is_collected": list_item.id in collected_ids,
                "created_at": _to_shanghai_iso(list_item.created_at),
                "favorites": [{
                    "id": fav.id,
                    "media_id": fav.media_id,
                    "media_type": fav.media_type,
                    "title": fav.title,
                    "poster": fav.poster,
                    "sort_order": fav.sort_order
                } for fav in favorites]
            })

        favorites_count = sum(len(item.get("favorites") or []) for item in result)
        payload_bytes = len(json.dumps(result, ensure_ascii=False))
        _log_favorite_api(
            request=request,
            endpoint="/api/users/{user_id}/favorite-lists/light",
            start_ts=start_ts,
            list_count=len(result),
            favorites_count=favorites_count,
            payload_bytes=payload_bytes,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取用户轻量收藏列表失败: {str(e)}"
        )

@app.post("/api/users/{user_id}/follow")
async def follow_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="不能关注自己")
    
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    follow = db.query(Follow).filter(
        Follow.follower_id == current_user.id,
        Follow.following_id == user_id
    ).first()
    
    if follow:
        raise HTTPException(status_code=400, detail="已经关注该用户")
    
    try:
        new_follow = Follow(
            follower_id=current_user.id,
            following_id=user_id
        )
        
        db.add(new_follow)
        
        _create_notification(
            db,
            user_id=int(target_user.id),
            type_="follow_user_new_follower",
            content=f"{current_user.username} 关注了你",
            link=f"/profile/{current_user.id}",
        )
        db.commit()
        db.refresh(new_follow)
            
        return {"message": "关注成功", "is_following": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"关注失败: {str(e)}")

@app.delete("/api/users/{user_id}/follow")
async def unfollow_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    follow = db.query(Follow).filter(
        Follow.follower_id == current_user.id,
        Follow.following_id == user_id
    ).first()
    
    if not follow:
        raise HTTPException(status_code=404, detail="未关注该用户")
    
    try:
        db.delete(follow)
        db.commit()
        return {"message": "取消关注成功"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="取消关注失败")

@app.get("/api/users/me/following")
async def get_following(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        follows = (
            db.query(Follow)
            .options(selectinload(Follow.following))
            .filter(Follow.follower_id == current_user.id)
            .all()
        )

        return [
            {
                "id": follow.following.id,
                "username": follow.following.username,
                "avatar": _avatar_url_or_none(follow.following),
                "note": follow.note,
                "created_at": _to_shanghai_iso(follow.created_at),
            }
            for follow in follows
            if follow.following is not None
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取关注列表失败: {str(e)}"
        )

@app.put("/api/users/{user_id}/follow/note")
async def update_follow_note(
    user_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        body = await request.json()
        note = body.get("note")
        
        follow = db.query(Follow).filter(
            and_(
                Follow.follower_id == current_user.id,
                Follow.following_id == user_id
            )
        ).first()
        
        if not follow:
            raise HTTPException(status_code=404, detail="未关注该用户")
        
        follow.note = note
        db.commit()
        db.refresh(follow)
        
        return {"message": "更新备注成功"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"更新备注失败: {str(e)}"
        )

@app.get("/api/users/{user_id}/follow/status")
async def get_follow_status(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    is_following = check_following_status(db, current_user.id, user_id)
    return {"is_following": is_following}

@app.get("/api/debug/follows")
async def debug_follows(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    follows = db.query(Follow).filter(
        Follow.follower_id == current_user.id
    ).all()
    
    return [
        {
            "follower_id": f.follower_id,
            "following_id": f.following_id,
            "created_at": _to_shanghai_iso(f.created_at)
        }
        for f in follows
    ]

# ==========================================
# 6. 站内通知
# ==========================================

@app.get("/api/notifications")
async def get_notifications(
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))

    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    items = q.order_by(desc(Notification.created_at)).offset(offset).limit(limit).all()
    return [_serialize_notification(n) for n in items]

@app.get("/api/notifications/unread-count")
async def get_unread_notifications_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cnt = (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .scalar()
    )
    return {"count": int(cnt or 0)}

@app.put("/api/notifications/read")
async def mark_notifications_read(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}

    ids = body.get("ids")
    mark_all = bool(body.get("all"))
    updated = 0

    try:
        now = datetime.utcnow()
        if mark_all:
            updated = (
                db.query(Notification)
                .filter(Notification.user_id == current_user.id, Notification.is_read == False)  # noqa: E712
                .update({"is_read": True, "read_at": now}, synchronize_session=False)
            )
        elif isinstance(ids, list) and ids:
            cleaned_ids: list[int] = []
            for x in ids:
                try:
                    cleaned_ids.append(int(x))
                except Exception:
                    continue
            if cleaned_ids:
                updated = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == current_user.id,
                        Notification.id.in_(cleaned_ids),
                    )
                    .update({"is_read": True, "read_at": now}, synchronize_session=False)
                )
        db.commit()
        return {"updated": int(updated or 0)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"标记已读失败: {str(e)}")

@app.delete("/api/notifications")
async def delete_notifications(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}

    ids = body.get("ids")
    delete_all = bool(body.get("all"))
    deleted = 0

    try:
        if delete_all:
            deleted = (
                db.query(Notification)
                .filter(Notification.user_id == current_user.id)
                .delete(synchronize_session=False)
            )
        elif isinstance(ids, list) and ids:
            cleaned_ids: list[int] = []
            for x in ids:
                try:
                    cleaned_ids.append(int(x))
                except Exception:
                    continue
            if cleaned_ids:
                deleted = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == current_user.id,
                        Notification.id.in_(cleaned_ids),
                    )
                    .delete(synchronize_session=False)
                )
        db.commit()
        return {"deleted": int(deleted or 0)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"清除通知失败: {str(e)}")

# ==========================================
# 7. 评分获取与图片代理
# ==========================================

@app.get("/")
async def root():
    return {"status": "ok", "message": "RateFuse API is running"}

@app.post("/api/ratings/batch")
async def get_batch_ratings(
    request: Request, 
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    start_time = time.time()
    try:
        body = await request.json()
        items = body.get('items', [])
        max_concurrent = body.get('max_concurrent', 5)
        
        if not items or len(items) == 0:
            raise HTTPException(status_code=400, detail="items不能为空")
        
        if len(items) > 50:
            raise HTTPException(status_code=400, detail="单次最多支持50个影视")
        
        logger.info(f"\n{'='*60}\n  批量获取评分 | 数量: {len(items)} | 并发: {max_concurrent}\n{'='*60}")
        
        douban_cookie = None
        if current_user:
            if current_user.douban_cookie:
                douban_cookie = current_user.douban_cookie
                print(f"✅ 已获取用户 {current_user.id} 的豆瓣Cookie（长度: {len(douban_cookie)}）")
            else:
                print(f"⚠️ 用户 {current_user.id} 未设置豆瓣Cookie")
        else:
            print("⚠️ 未登录用户，无法使用豆瓣Cookie")
        
        async def get_item_info(item):
            media_id = item['id']
            media_type = item['type']
            
            cache_key = f"ratings:all:{media_type}:{media_id}"
            cached = await get_cache(cache_key)
            if cached:
                return media_id, {'cached': True, 'data': cached}
            
            try:
                tmdb_info = await get_tmdb_info_cached(media_id, media_type, request)
                if not tmdb_info:
                    return media_id, {'error': 'TMDB信息获取失败'}
                
                return media_id, {'tmdb_info': tmdb_info, 'type': media_type}
            except Exception as e:
                return media_id, {'error': str(e)}
        
        tmdb_tasks = [get_item_info(item) for item in items]
        tmdb_results = await asyncio.gather(*tmdb_tasks, return_exceptions=True)
        
        cached_results = {}
        to_fetch = []
        errors = {}
        
        for result in tmdb_results:
            if isinstance(result, Exception):
                continue
            media_id, data = result
            if data.get('cached'):
                cached_results[media_id] = data['data']
            elif 'tmdb_info' in data:
                to_fetch.append((media_id, data['tmdb_info'], data['type']))
            elif 'error' in data:
                errors[media_id] = data['error']
        
        logger.info(f"📊 缓存: {len(cached_results)} | 爬取: {len(to_fetch)} | 错误: {len(errors)}")
        
        sem = asyncio.Semaphore(max_concurrent)
        
        async def fetch_one_item(media_id, tmdb_info, media_type):
            async with sem:
                try:
                    item_start = time.time()
                    title = tmdb_info.get('zh_title') or tmdb_info.get('title', media_id)
                    logger.info(f"  → {title[:30]}... (ID: {media_id})")
                    
                    from ratings import parallel_extract_ratings
                    
                    ratings = await asyncio.wait_for(
                        parallel_extract_ratings(tmdb_info, media_type, request, douban_cookie),
                        timeout=20.0
                    )
                    
                    cache_key = f"ratings:all:{media_type}:{media_id}"
                    if ratings:
                        await set_cache(cache_key, ratings, expire=CACHE_EXPIRE_TIME)
                    
                    item_time = time.time() - item_start
                    logger.info(f"  ✓ {media_id}: {item_time:.1f}s")
                    
                    return media_id, {'ratings': ratings, 'status': 'success', 'time': item_time}
                    
                except asyncio.TimeoutError:
                    logger.warning(f"  ⏱ {media_id}: 超时")
                    return media_id, {'status': 'timeout', 'error': '获取超时（>20秒）'}
                except Exception as e:
                    logger.error(f"  ✗ {media_id}: {str(e)[:30]}")
                    return media_id, {'status': 'error', 'error': str(e)}
        
        if to_fetch:
            fetch_tasks = [
                fetch_one_item(media_id, tmdb_info, media_type)
                for media_id, tmdb_info, media_type in to_fetch
            ]
            fetch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        else:
            fetch_results = []
        
        final_results = {}
        
        for media_id, data in cached_results.items():
            final_results[media_id] = {
                'ratings': data,
                'status': 'success',
                'from_cache': True
            }
        
        for result in fetch_results:
            if isinstance(result, Exception):
                continue
            media_id, data = result
            final_results[media_id] = data
        
        for media_id, error in errors.items():
            final_results[media_id] = {
                'status': 'error',
                'error': error
            }
        
        total_time = time.time() - start_time
        success_count = sum(1 for r in final_results.values() if r.get('status') == 'success')
        
        logger.info(f"\n{'='*60}")
        logger.info(f"  ✓ 批量完成: {success_count}/{len(items)} 个 | 总耗时: {total_time:.1f}s | 平均: {total_time/len(items):.1f}s/个")
        logger.info(f"{'='*60}\n")
        
        return {
            'results': final_results,
            '_performance': {
                'total_time': round(total_time, 2),
                'total_items': len(items),
                'cached_items': len(cached_results),
                'fetched_items': len(to_fetch),
                'error_items': len(errors),
                'avg_time_per_item': round(total_time / len(items), 2) if items else 0,
                'max_concurrent': max_concurrent
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"批量获取评分失败: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"批量获取失败: {str(e)}")

@app.get("/api/ratings/all/{type}/{id}")
async def get_all_platform_ratings(
    type: str, 
    id: str, 
    request: Request,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    start_time = time.time()
    try:
        if await request.is_disconnected():
            print("请求已在开始时被取消")
            return None

        douban_cookie = None
        if current_user:
            if current_user.douban_cookie:
                douban_cookie = current_user.douban_cookie
                print(f"✅ 已获取用户 {current_user.id} 的豆瓣Cookie（长度: {len(douban_cookie)}）")
            else:
                print(f"⚠️ 用户 {current_user.id} 未设置豆瓣Cookie")
        else:
            print("⚠️ 未登录用户，无法使用豆瓣Cookie")
        
        cache_key = f"ratings:all:{type}:{id}"
        cached_data = await get_cache(cache_key)
        if cached_data:
            print(f"从缓存获取所有平台评分数据，耗时: {time.time() - start_time:.2f}秒")
            return cached_data
        
        tmdb_info = await get_tmdb_info_cached(id, type, request)
        if not tmdb_info:
            if await request.is_disconnected():
                print("请求在获取TMDB信息时被取消")
                return None
            raise HTTPException(status_code=404, detail="无法获取 TMDB 信息")
        
        if await request.is_disconnected():
            print("请求在获取TMDB信息后被取消")
            return None
        
        from ratings import parallel_extract_ratings
        
        try:
            all_ratings = await asyncio.wait_for(
                parallel_extract_ratings(tmdb_info, tmdb_info["type"], request, douban_cookie),
                timeout=20.0
            )
        except asyncio.TimeoutError:
            logger.error("获取评分超时（>20秒）")
            raise HTTPException(status_code=504, detail="获取评分超时")
        
        if await request.is_disconnected():
            return None
        
        total_time = time.time() - start_time
        
        if all_ratings:
            await set_cache(cache_key, all_ratings, expire=CACHE_EXPIRE_TIME)
        
        result = {
            "ratings": all_ratings,
            "_performance": {
                "total_time": round(total_time, 2),
                "cached": False,
                "parallel": True
            }
        }
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        if await request.is_disconnected():
            return None
        
        logger.error(f"获取所有平台评分失败: {str(e)[:100]}")
        raise HTTPException(status_code=500, detail=f"获取评分失败: {str(e)}")

@app.get("/api/ratings/tmdb/{type}/{id}")
async def get_tmdb_rating(
    type: str,
    id: str,
    request: Request,
):
    start_time = time.time()
    if type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="type 必须是 movie 或 tv")

    cache_key = f"tmdb:rating:{type}:{id}"
    cached = await get_cache(cache_key)
    if cached:
        logger.info(f"从缓存获取 tmdb 评分: {cache_key}")
        return cached

    if await request.is_disconnected():
        return None

    client = get_tmdb_http_client()
    endpoint = f"{TMDB_API_BASE_URL}/{type}/{id}"

    try:
        resp = await client.get(endpoint, params={"language": "zh-CN"})
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="TMDB API 请求失败")
        data = resp.json() or {}

        result: dict = {
            "rating": float(data.get("vote_average") or 0),
            "voteCount": int(data.get("vote_count") or 0),
        }

        if type == "tv":
            seasons = data.get("seasons") or []
            season_numbers: list[int] = []
            for s in seasons:
                if not isinstance(s, dict):
                    continue
                sn = s.get("season_number")
                try:
                    sn_int = int(sn)
                except (TypeError, ValueError):
                    continue
                if sn_int <= 0:
                    continue
                season_numbers.append(sn_int)

            sem = asyncio.Semaphore(6)

            async def fetch_season(sn_int: int):
                async with sem:
                    if await request.is_disconnected():
                        return None
                    season_endpoint = f"{TMDB_API_BASE_URL}/{type}/{id}/season/{sn_int}"
                    r = await client.get(season_endpoint, params={"language": "zh-CN"})
                    if r.status_code != 200:
                        return {"season_number": sn_int, "rating": 0.0, "voteCount": 0}
                    sd = r.json() or {}
                    return {
                        "season_number": sn_int,
                        "rating": float(sd.get("vote_average") or 0),
                        "voteCount": int(sd.get("vote_count") or 0),
                    }

            season_results = await asyncio.gather(
                *[fetch_season(sn) for sn in season_numbers],
                return_exceptions=True,
            )

            cleaned = []
            for item in season_results:
                if isinstance(item, Exception) or not item:
                    continue
                cleaned.append(item)
            result["seasons"] = cleaned

        await set_cache(cache_key, result, expire=CACHE_EXPIRE_TIME)
        result["_performance"] = {"total_time": round(time.time() - start_time, 2), "cached": False}
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取 TMDB 评分失败: {str(e)[:200]}")
        raise HTTPException(status_code=500, detail=f"获取 TMDB 评分失败: {str(e)}")

@app.get("/api/ratings/{platform}/{type}/{id}")
async def get_platform_rating(
    platform: str, 
    type: str, 
    id: str, 
    request: Request,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    start_time = time.time()
    try:
        if await request.is_disconnected():
            print(f"{platform} 请求已在开始时被取消")
            return None
        
        douban_cookie = None
        if platform == "douban":
            if current_user:
                if current_user.douban_cookie:
                    douban_cookie = current_user.douban_cookie
                    print(f"✅ 已获取用户 {current_user.id} 的豆瓣Cookie（长度: {len(douban_cookie)}）")
                else:
                    print(f"⚠️ 用户 {current_user.id} 未设置豆瓣Cookie")
            else:
                print("⚠️ 未登录用户，无法使用豆瓣Cookie")
        
        media_type = type
        tmdb_id: Optional[int] = None
        try:
            tmdb_id = int(id)
        except Exception:
            tmdb_id = None

        if tmdb_id is not None and is_platform_locked(db, media_type, tmdb_id, platform):
            rating_info = create_rating_data(RATING_STATUS["LOCKED"], "平台已锁定，停止抓取")
            rating_info["_performance"] = {
                "total_time": round(time.time() - start_time, 2),
                "search_time": 0,
                "extract_time": 0,
                "cached": False,
            }
            return rating_info

        cache_key = f"rating:{platform}:{type}:{id}"
        cached_data = await get_cache(cache_key)
        if cached_data:
            print(f"从缓存获取 {platform} 评分数据，耗时: {time.time() - start_time:.2f}秒")
            return cached_data

        tmdb_info = await get_tmdb_info_cached(id, type, request)
        if not tmdb_info:
            if await request.is_disconnected():
                print(f"{platform} 请求在获取TMDB信息时被取消")
                return None
            raise HTTPException(status_code=404, detail="无法获取 TMDB 信息")

        if await request.is_disconnected():
            print(f"{platform} 请求在获取TMDB信息后被取消")
            return None

        media_type = tmdb_info.get("type") or media_type
        if tmdb_id is None:
            tmdb_id = tmdb_info.get("id")

        search_start_time = time.time()
        extract_start_time = search_start_time

        if platform == "douban":
            rating_info = await douban_search_and_extract_rating(
                media_type, tmdb_info, request, douban_cookie
            )
            search_results = None
        else:
            search_results = await search_platform(platform, tmdb_info, request, douban_cookie)

            if isinstance(search_results, dict) and search_results.get("status") in (
                RATING_STATUS["NO_FOUND"],
                RATING_STATUS["RATE_LIMIT"],
                RATING_STATUS["TIMEOUT"],
                RATING_STATUS["FETCH_FAILED"],
            ):
                reason = search_results.get("status_reason") or search_results.get("status")
                rating_info = create_rating_data(search_results["status"], reason)
                rating_info["_performance"] = {
                    "total_time": round(time.time() - start_time, 2),
                    "search_time": round(time.time() - search_start_time, 2),
                    "extract_time": 0,
                    "cached": False,
                }
                if tmdb_id is not None:
                    update_platform_status_after_fetch(
                        db,
                        media_type=media_type,
                        tmdb_id=tmdb_id,
                        platform=platform,
                        title=tmdb_info.get("title") or tmdb_info.get("name"),
                        status=rating_info["status"],
                        status_reason=rating_info.get("status_reason"),
                    )
                    db.commit()
                return rating_info

            if await request.is_disconnected():
                print(f"{platform} 请求在搜索平台后被取消")
                return None

            if isinstance(search_results, dict) and search_results.get("status") == "cancelled":
                print(f"{platform} 搜索被取消")
                return None

            extract_start_time = time.time()
            rating_info = await extract_rating_info(type, platform, tmdb_info, search_results, request, douban_cookie)

        if platform == "douban":
            if isinstance(rating_info, dict) and rating_info.get("status") in (
                RATING_STATUS["NO_FOUND"],
                RATING_STATUS["RATE_LIMIT"],
                RATING_STATUS["TIMEOUT"],
                RATING_STATUS["FETCH_FAILED"],
            ):
                rating_info["_performance"] = {
                    "total_time": round(time.time() - start_time, 2),
                    "search_time": round(time.time() - search_start_time, 2),
                    "extract_time": round(time.time() - extract_start_time, 2),
                    "cached": False,
                }
                if tmdb_id is not None:
                    update_platform_status_after_fetch(
                        db,
                        media_type=media_type,
                        tmdb_id=tmdb_id,
                        platform=platform,
                        title=tmdb_info.get("title") or tmdb_info.get("name"),
                        status=rating_info["status"],
                        status_reason=rating_info.get("status_reason"),
                    )
                    db.commit()
                return rating_info

            if await request.is_disconnected():
                print(f"{platform} 请求在搜索平台后被取消")
                return None

            if isinstance(rating_info, dict) and rating_info.get("status") == "cancelled":
                print(f"{platform} 搜索被取消")
                return None

        if await request.is_disconnected():
            print(f"{platform} 请求在获取评分信息后被取消")
            return None

        if not rating_info:
            if await request.is_disconnected():
                print(f"{platform} 请求在处理评分信息时被取消")
                return None
            raise HTTPException(status_code=404, detail=f"未找到 {platform} 的评分信息")

        if isinstance(rating_info, dict) and rating_info.get("status") == "cancelled":
            print(f"{platform} 评分提取被取消")
            return None

        if isinstance(rating_info, dict) and rating_info.get("status") == RATING_STATUS["SUCCESSFUL"]:
            await set_cache(cache_key, rating_info)
            print(f"已缓存 {platform} 评分数据")
        else:
            print(f"不缓存 {platform} 评分数据，状态: {rating_info.get('status')}")

        total_time = time.time() - start_time
        
        if isinstance(rating_info, dict):
            rating_info["_performance"] = {
                "total_time": round(total_time, 2),
                "search_time": round(time.time() - search_start_time, 2),
                "extract_time": round(time.time() - extract_start_time, 2),
                "cached": False,
            }

            if tmdb_id is not None:
                update_platform_status_after_fetch(
                    db,
                    media_type=media_type,
                    tmdb_id=tmdb_id,
                    platform=platform,
                    title=tmdb_info.get("title") or tmdb_info.get("name"),
                    status=rating_info.get("status"),
                    status_reason=rating_info.get("status_reason"),
                )
                db.commit()

        return rating_info

    except HTTPException:
        raise
    except Exception as e:
        if await request.is_disconnected():
            print(f"{platform} 请求在发生错误时被取消")
            return None
        
        print(f"获取 {platform} 评分时出错: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"获取评分失败: {str(e)}")
    finally:
        print(f"{platform} 请求处理完成，总耗时: {time.time() - start_time:.2f}秒")

router = APIRouter()

_tmdb_client = None

async def get_tmdb_client():
    global _tmdb_client
    if _tmdb_client is None or _tmdb_client.is_closed:
        _tmdb_client = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20,
                keepalive_expiry=30.0
            ),
            headers={
                "accept": "application/json",
                "accept-encoding": "gzip, deflate",
                "Authorization": f"Bearer {TMDB_TOKEN}"
            }
        )
    return _tmdb_client

def _normalized_query_for_cache(query_params) -> str:
    if not query_params:
        return ""
    sorted_items = sorted(query_params.items(), key=lambda x: x[0])
    return "&".join(f"{k}={v}" for k, v in sorted_items)

_tmdb_search_times: dict[str, list[float]] = {}
_tmdb_rate_lock = asyncio.Lock()
TMDB_SEARCH_LIMIT = 10
TMDB_SEARCH_WINDOW = 10.0

async def _check_tmdb_search_rate_limit(client_ip: str) -> None:
    if not client_ip:
        return
    now = time.time()
    async with _tmdb_rate_lock:
        if client_ip not in _tmdb_search_times:
            _tmdb_search_times[client_ip] = []
        times = _tmdb_search_times[client_ip]
        times[:] = [t for t in times if now - t < TMDB_SEARCH_WINDOW]
        if len(times) >= TMDB_SEARCH_LIMIT:
            raise HTTPException(status_code=429, detail="TMDB 搜索请求过于频繁，请稍后再试")
        times.append(now)

@router.get("/api/tmdb-proxy/{path:path}")
async def tmdb_proxy(path: str, request: Request):
    try:
        qs = _normalized_query_for_cache(dict(request.query_params))
        cache_key = f"tmdb:{path}:{qs}"
        cached_data = await get_cache(cache_key)
        if cached_data:
            return cached_data
        if path.strip("/").startswith("search"):
            client_ip = request.client.host if request.client else ""
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                client_ip = forwarded.split(",")[0].strip()
            await _check_tmdb_search_rate_limit(client_ip)
        
        params = dict(request.query_params)
        tmdb_url = f"{TMDB_API_BASE_URL}/{path}"
        client = await get_tmdb_client()
        
        try:
            response = await client.get(tmdb_url, params=params)
            
            if response.status_code != 200:
                try:
                    err_json = response.json()
                except Exception:
                    err_json = {"error": response.text}
                raise HTTPException(status_code=response.status_code, detail={
                    "message": "TMDB API 请求失败",
                    "status": response.status_code,
                    "body": err_json
                })
            
            data = response.json()
            await set_cache(cache_key, data)
            
            return data
            
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="TMDB API 请求超时")
        except httpx.HTTPError as e:
            raise HTTPException(status_code=500, detail=f"HTTP 请求错误: {str(e)}")
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"代理请求失败: {str(e)}")

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate"
        }
    )

@router.get("/api/trakt-proxy/{path:path}")
async def trakt_proxy(path: str, request: Request):
    try:
        cache_key = f"trakt:{path}:{request.query_params}"
        cached_data = await get_cache(cache_key)
        if cached_data:
            return cached_data
        
        trakt_url = f"{TRAKT_BASE_URL}/{path}"
        params = dict(request.query_params)
        headers = {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': TRAKT_CLIENT_ID
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(trakt_url, params=params, headers=headers) as response:
                if response.status != 200:
                    return HTTPException(status_code=response.status, detail="Trakt API 请求失败")
                
                data = await response.json()
                await set_cache(cache_key, data)
                
                return data
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"代理请求失败: {str(e)}")

app.include_router(router)

# ==========================================
# 8. 反馈
# ==========================================

UPLOAD_ROOT = os.path.join(os.path.dirname(__file__), "uploads")
FEEDBACK_UPLOAD_DIR = os.path.join(UPLOAD_ROOT, "feedback")

os.makedirs(FEEDBACK_UPLOAD_DIR, exist_ok=True)

@app.get("/uploads/feedback/{filename}")
async def get_feedback_image(filename: str):
    safe_filename = os.path.basename(filename)
    abs_base = os.path.abspath(FEEDBACK_UPLOAD_DIR)
    abs_target = os.path.abspath(os.path.join(FEEDBACK_UPLOAD_DIR, safe_filename))
    if not abs_target.startswith(abs_base + os.sep):
        raise HTTPException(status_code=400, detail="非法文件名")
    if not os.path.exists(abs_target) or not os.path.isfile(abs_target):
        raise HTTPException(status_code=404, detail="图片不存在")

    media_type, _ = mimetypes.guess_type(abs_target)
    media_type = media_type or "application/octet-stream"
    return FileResponse(
        abs_target,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

@app.get("/api/debug/feedback-image")
async def debug_feedback_image(filename: str):
    safe_filename = os.path.basename(filename)
    abs_base = os.path.abspath(FEEDBACK_UPLOAD_DIR)
    abs_target = os.path.abspath(os.path.join(FEEDBACK_UPLOAD_DIR, safe_filename))
    exists = os.path.exists(abs_target) and os.path.isfile(abs_target)
    size = os.path.getsize(abs_target) if exists else None
    media_type, _ = mimetypes.guess_type(abs_target) if exists else (None, None)
    head_hex = None
    if exists:
        try:
            with open(abs_target, "rb") as f:
                head_hex = f.read(8).hex()
        except Exception:
            head_hex = None
    return {
        "filename": filename,
        "safe_filename": safe_filename,
        "abs_target": abs_target,
        "exists": exists,
        "size": size,
        "guessed_media_type": media_type,
        "head_hex": head_hex,
    }

@app.get("/api/feedback-image")
async def feedback_image_api(filename: str):
    safe_filename = os.path.basename(filename)
    abs_base = os.path.abspath(FEEDBACK_UPLOAD_DIR)
    abs_target = os.path.abspath(os.path.join(FEEDBACK_UPLOAD_DIR, safe_filename))
    if not abs_target.startswith(abs_base + os.sep):
        raise HTTPException(status_code=400, detail="非法文件名")
    if not os.path.exists(abs_target) or not os.path.isfile(abs_target):
        raise HTTPException(status_code=404, detail="图片不存在")

    media_type, _ = mimetypes.guess_type(abs_target)
    media_type = media_type or "application/octet-stream"
    return FileResponse(
        abs_target,
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )

class TelegramUpdate(BaseModel):
    update_id: int
    message: Optional[dict] = None
    callback_query: Optional[dict] = None

@app.post("/api/telegram/webhook")
async def telegram_webhook(update: TelegramUpdate, db: Session = Depends(get_db)):
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False}

    if update.callback_query:
        cq = update.callback_query
        data = cq.get("data") or ""
        parts = str(data).split(":")
        if len(parts) == 4 and parts[0] == "fb" and parts[2] == "status":
            try:
                feedback_id = int(parts[1])
                new_status = parts[3]
            except Exception:
                return {"ok": True}

            if new_status not in ("pending", "replied", "closed"):
                return {"ok": True}

            feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
            if not feedback:
                return {"ok": True}

            from_status = feedback.status
            now = _now_utc_naive()
            feedback.status = new_status
            feedback.updated_at = now
            if new_status == "closed":
                feedback.closed_by = "telegram"
                feedback.closed_at = now
            else:
                feedback.closed_by = None
                feedback.closed_at = None
            if new_status == "pending":
                feedback.is_resolved_by_user = False
                feedback.resolved_at = None

            if from_status != new_status:
                _add_status_event(
                    db,
                    feedback_id=feedback.id,
                    from_status=from_status,
                    to_status=new_status,
                    changed_by_id=None,
                    changed_by_type="telegram",
                    reason="Telegram 按钮修改状态",
                )
            db.commit()
        return {"ok": True}

    msg = update.message or {}
    if not msg:
        return {"ok": True}

    reply_to = msg.get("reply_to_message") or {}
    if not reply_to:
        return {"ok": True}

    reply_message_id = reply_to.get("message_id")
    chat = reply_to.get("chat") or {}
    chat_id = chat.get("id")
    if not reply_message_id or not chat_id:
        return {"ok": True}

    mapping = (
        db.query(TelegramFeedbackMapping)
        .filter(
            TelegramFeedbackMapping.telegram_chat_id == int(chat_id),
            TelegramFeedbackMapping.telegram_message_id == int(reply_message_id),
        )
        .first()
    )
    if not mapping:
        return {"ok": True}

    feedback = db.query(Feedback).filter(Feedback.id == mapping.feedback_id).first()
    if not feedback:
        return {"ok": True}

    text = str(msg.get("text") or "").strip()
    if not text:
        return {"ok": True}

    now = _now_utc_naive()
    message = FeedbackMessage(
        feedback_id=feedback.id,
        sender_id=None,
        sender_type="admin",
        content=text,
        created_at=now,
    )
    db.add(message)

    from_status = feedback.status
    feedback.status = "replied"
    feedback.last_message_at = now
    feedback.updated_at = now
    if from_status != feedback.status:
        _add_status_event(
            db,
            feedback_id=feedback.id,
            from_status=from_status,
            to_status=feedback.status,
            changed_by_id=None,
            changed_by_type="telegram",
            reason="Telegram 管理员回复",
        )

    fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
    _create_notification(
        db,
        user_id=feedback.user_id,
        type_="feedback_reply",
        content=f"管理员回复了你的反馈《{fb_title}》",
        link=f"/profile?tab=feedbacks&feedback_id={feedback.id}",
    )

    db.commit()
    return {"ok": True}

def require_admin(user: User):
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")

_TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")

def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def _iso_now_shanghai() -> str:
    return _to_shanghai_iso(_now_utc_naive()) or ""

def _to_shanghai_iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    aware_utc = dt.replace(tzinfo=timezone.utc)
    return aware_utc.astimezone(_TZ_SHANGHAI).isoformat()

def _parse_iso_to_utc_naive(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_TZ_SHANGHAI)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)

def _add_status_event(
    db: Session,
    feedback_id: int,
    from_status: Optional[str],
    to_status: str,
    changed_by_id: Optional[int],
    changed_by_type: str,
    reason: Optional[str] = None,
):
    evt = FeedbackStatusEvent(
        feedback_id=feedback_id,
        from_status=from_status,
        to_status=to_status,
        changed_by_id=changed_by_id,
        changed_by_type=changed_by_type,
        reason=reason,
        created_at=_now_utc_naive(),
    )
    db.add(evt)

async def _send_telegram_message_for_feedback(
    db: Session,
    feedback: Feedback,
    text: str,
    reply_to_root: bool = True,
):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ADMIN_CHAT_IDS:
        return
    text = str(text or "")
    if not text.strip():
        text = f"收到新的反馈（#{feedback.id}）"

    def _to_telegram_caption_plain(html_text: str, max_len: int = 1000) -> str:
        plain = re.sub(r"<[^>]*>", "", str(html_text or ""))
        plain = html_unescape(plain)
        plain = plain.strip()
        if len(plain) > max_len:
            return plain[: max_len - 3] + "..."
        return plain

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    url_photo = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "标记为待处理", "callback_data": f"fb:{feedback.id}:status:pending"},
                {"text": "标记为已回复", "callback_data": f"fb:{feedback.id}:status:replied"},
                {"text": "关闭反馈", "callback_data": f"fb:{feedback.id}:status:closed"},
            ]
        ]
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        for chat_id in TELEGRAM_ADMIN_CHAT_IDS:
            mapping = (
                db.query(TelegramFeedbackMapping)
                .filter(
                    TelegramFeedbackMapping.feedback_id == feedback.id,
                    TelegramFeedbackMapping.telegram_chat_id == int(chat_id),
                )
                .first()
            )
            reply_to_message_id = mapping.telegram_message_id if (mapping and reply_to_root) else None

            image_records = list(getattr(feedback, "images", []) or [])
            if not image_records:
                try:
                    image_records = (
                        db.query(FeedbackImage)
                        .filter(FeedbackImage.feedback_id == feedback.id)
                        .order_by(FeedbackImage.id.asc())
                        .all()
                    )
                except Exception:
                    image_records = []

            first_image = image_records[0] if image_records else None
            sent_photo_ok = False

            if first_image:
                p = str(getattr(first_image, "image_path", "") or "")
                if p.startswith("/uploads/feedback/"):
                    stored_name = p.split("/uploads/feedback/", 1)[1]
                    abs_path = os.path.join(FEEDBACK_UPLOAD_DIR, stored_name)
                    if os.path.exists(abs_path) and os.path.isfile(abs_path):
                        try:
                            with open(abs_path, "rb") as f:
                                img_bytes = f.read()
                            content_type, _ = mimetypes.guess_type(abs_path)
                            content_type = content_type or "image/jpeg"
                            filename = os.path.basename(abs_path)
                            caption = _to_telegram_caption_plain(text)

                            payload_photo: dict[str, Any] = {
                                "chat_id": chat_id,
                                "caption": caption,
                                "reply_markup": json.dumps(keyboard),
                            }
                            if reply_to_message_id:
                                payload_photo["reply_to_message_id"] = reply_to_message_id

                            resp = await client.post(
                                url_photo,
                                data=payload_photo,
                                files={"photo": (filename, img_bytes, content_type)},
                            )
                            tdata = resp.json() if resp.text else {}
                            if resp.status_code == 200 and tdata.get("ok"):
                                sent_photo_ok = True
                                msg = tdata.get("result") or {}
                                chat = msg.get("chat") or {}
                                message_id = msg.get("message_id")
                                chat_id_resp = chat.get("id")
                                if chat_id_resp and message_id:
                                    _upsert_telegram_mapping(
                                        db, feedback.id, int(chat_id_resp), int(message_id)
                                    )
                        except Exception:
                            sent_photo_ok = False

            if not sent_photo_ok:
                payload: dict[str, Any] = {
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "reply_markup": json.dumps(keyboard),
                }
                if reply_to_message_id:
                    payload["reply_to_message_id"] = reply_to_message_id
                try:
                    resp = await client.post(url, data=payload)
                    data = resp.json() if resp.text else {}
                    if resp.status_code == 200 and data.get("ok"):
                        msg = data.get("result") or {}
                        chat = msg.get("chat") or {}
                        message_id = msg.get("message_id")
                        chat_id_resp = chat.get("id")
                        if chat_id_resp and message_id:
                            _upsert_telegram_mapping(
                                db, feedback.id, int(chat_id_resp), int(message_id)
                            )
                except Exception:
                    pass

def _upsert_telegram_mapping(db: Session, feedback_id: int, telegram_chat_id: int, telegram_message_id: int):
    existing = (
        db.query(TelegramFeedbackMapping)
        .filter(
            TelegramFeedbackMapping.feedback_id == feedback_id,
            TelegramFeedbackMapping.telegram_chat_id == telegram_chat_id,
        )
        .first()
    )
    now = _now_utc_naive()
    if existing:
        existing.telegram_message_id = telegram_message_id
        existing.updated_at = now
    else:
        db.add(
            TelegramFeedbackMapping(
                feedback_id=feedback_id,
                telegram_chat_id=telegram_chat_id,
                telegram_message_id=telegram_message_id,
                created_at=now,
                updated_at=now,
            )
        )
    db.commit()

def _serialize_feedback(feedback: Feedback, include_messages: bool = False, include_user: bool = False):
    data = {
        "id": feedback.id,
        "user_id": feedback.user_id,
        "title": feedback.title,
        "status": feedback.status,
        "is_resolved_by_user": getattr(feedback, "is_resolved_by_user", False),
        "resolved_at": _to_shanghai_iso(getattr(feedback, "resolved_at", None)),
        "closed_by": getattr(feedback, "closed_by", None),
        "closed_at": _to_shanghai_iso(getattr(feedback, "closed_at", None)),
        "created_at": _to_shanghai_iso(feedback.created_at),
        "updated_at": _to_shanghai_iso(feedback.updated_at),
        "last_message_at": _to_shanghai_iso(feedback.last_message_at),
        "images": [
            (
                (
                    f"/api/feedback-image?filename={quote(img.image_path.split('/uploads/feedback/', 1)[1])}"
                    if str(getattr(img, "image_path", "")).startswith("/uploads/feedback/")
                    else str(getattr(img, "image_path", ""))
                )
            )
            for img in (getattr(feedback, "images", []) or [])
            if getattr(img, "image_path", None)
        ],
    }

    if include_user and getattr(feedback, "user", None):
        data["user"] = {
            "id": feedback.user.id,
            "email": feedback.user.email,
            "username": feedback.user.username,
        }

    if include_messages:
        data["messages"] = [
            {
                "id": msg.id,
                "sender_id": msg.sender_id,
                "sender_type": msg.sender_type,
                "content": msg.content,
                "created_at": _to_shanghai_iso(msg.created_at),
            }
            for msg in sorted(feedback.messages, key=lambda m: m.created_at or _now_utc_naive())
        ]

    return data

def _delete_feedback_files(feedback: Feedback):
    for img in getattr(feedback, "images", []) or []:
        try:
            p = str(img.image_path or "")
            if not p:
                continue
            if p.startswith("/uploads/feedback/"):
                filename = p.split("/uploads/feedback/", 1)[1]
                abs_path = os.path.join(FEEDBACK_UPLOAD_DIR, filename)
                if os.path.exists(abs_path):
                    os.remove(abs_path)
        except Exception:
            pass

@app.post("/api/feedbacks")
async def create_feedback(
    content: str = Form(...),
    title: Optional[str] = Form(None),
    page_url: Optional[str] = Form(None),
    images: list[UploadFile] = File(default_factory=list),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not content.strip():
        raise HTTPException(status_code=400, detail="反馈内容不能为空")

    feedback = Feedback(
        user_id=current_user.id,
        title=title.strip() if title else None,
        status="pending",
        is_resolved_by_user=False,
        resolved_at=None,
        closed_by=None,
        closed_at=None,
        created_at=_now_utc_naive(),
        updated_at=_now_utc_naive(),
        last_message_at=_now_utc_naive(),
    )
    db.add(feedback)
    db.flush()
    _add_status_event(
        db,
        feedback_id=feedback.id,
        from_status=None,
        to_status="pending",
        changed_by_id=current_user.id,
        changed_by_type="user",
        reason="用户创建反馈",
    )

    message = FeedbackMessage(
        feedback_id=feedback.id,
        sender_id=current_user.id,
        sender_type="user",
        content=content.strip(),
        created_at=_now_utc_naive(),
    )
    db.add(message)

    fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
    actor = (current_user.username or "").strip() or f"用户#{current_user.id}"
    _notify_admins(
        db,
        type_="feedback_new",
        content=f"{actor} 提交了新的反馈《{fb_title}》",
        link="/admin/feedbacks",
        exclude_user_id=current_user.id,
    )

    saved_images: list[FeedbackImage] = []
    for idx, upload in enumerate(images or []):
        if not upload.filename:
            continue
        filename = upload.filename
        _, ext = os.path.splitext(filename)
        safe_ext = ext.lower() if ext else ""
        ts = int(time.time() * 1000)
        stored_name = f"{feedback.id}_{ts}_{idx}{safe_ext}"
        stored_path = os.path.join(FEEDBACK_UPLOAD_DIR, stored_name)

        content_bytes = await upload.read()
        if len(content_bytes) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片大小不能超过 5MB")
        with open(stored_path, "wb") as f:
            f.write(content_bytes)

        relative_path = f"/uploads/feedback/{stored_name}"
        img = FeedbackImage(
            feedback_id=feedback.id,
            image_path=relative_path,
            created_at=_now_utc_naive(),
        )
        db.add(img)
        saved_images.append(img)

    db.commit()
    db.refresh(feedback)

    try:
        fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
        actor = (current_user.username or "").strip() or f"用户#{current_user.id}"
        safe_fb_title = html_escape(fb_title)
        safe_actor = html_escape(actor)
        safe_content = html_escape(content.strip())
        lines = [
            f"<b>{safe_fb_title}</b>",
            f"来自用户：{safe_actor} (ID: {current_user.id})",
            "",
            safe_content,
        ]
        if page_url:
            lines.append("")
            lines.append(f"页面来源：{html_escape(page_url)}")
        text = "\n".join(lines)
        await _send_telegram_message_for_feedback(db, feedback, text, reply_to_root=False)
    except Exception:
        pass

    return _serialize_feedback(feedback, include_messages=True)

@app.delete("/api/feedbacks/{feedback_id}")
async def user_delete_feedback(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feedback = (
        db.query(Feedback)
        .options(selectinload(Feedback.images))
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")
    if feedback.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除该反馈")

    db.query(TelegramFeedbackMapping).filter(TelegramFeedbackMapping.feedback_id == feedback.id).delete()
    _delete_feedback_files(feedback)
    db.delete(feedback)
    db.commit()
    return {"ok": True}

@app.post("/api/feedbacks/{feedback_id}/messages")
async def user_reply_feedback(
    feedback_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payload = await request.json()
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="回复内容不能为空")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")
    if feedback.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作该反馈")
    if feedback.status == "closed":
        raise HTTPException(status_code=400, detail="该反馈已关闭，无法继续回复")

    now = _now_utc_naive()
    msg = FeedbackMessage(
        feedback_id=feedback.id,
        sender_id=current_user.id,
        sender_type="user",
        content=content,
        created_at=now,
    )
    db.add(msg)

    from_status = feedback.status
    if feedback.status != "pending":
        feedback.status = "pending"
        _add_status_event(
            db,
            feedback_id=feedback.id,
            from_status=from_status,
            to_status="pending",
            changed_by_id=current_user.id,
            changed_by_type="user",
            reason="用户追加问题",
        )
    feedback.is_resolved_by_user = False
    feedback.resolved_at = None
    feedback.last_message_at = now
    feedback.updated_at = now

    fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
    actor = (current_user.username or "").strip() or f"用户#{current_user.id}"
    _notify_admins(
        db,
        type_="feedback_update",
        content=f"{actor} 追加了反馈《{fb_title}》的新消息",
        link="/admin/feedbacks",
        exclude_user_id=current_user.id,
    )

    db.commit()
    db.refresh(feedback)

    try:
        text = f"用户追加反馈 #{feedback.id}：\n{html_escape(content)}"
        await _send_telegram_message_for_feedback(db, feedback, text)
    except Exception:
        pass

    return _serialize_feedback(
        db.query(Feedback)
        .options(selectinload(Feedback.messages), selectinload(Feedback.images))
        .filter(Feedback.id == feedback.id)
        .first(),
        include_messages=True,
    )

@app.post("/api/feedbacks/{feedback_id}/resolve")
async def user_mark_feedback_resolved(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")
    if feedback.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作该反馈")
    if feedback.status == "closed":
        raise HTTPException(status_code=400, detail="该反馈已关闭，无需标记")

    now = _now_utc_naive()
    feedback.is_resolved_by_user = True
    feedback.resolved_at = now
    feedback.updated_at = now

    fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
    actor = (current_user.username or "").strip() or f"用户#{current_user.id}"
    _notify_admins(
        db,
        type_="feedback_update",
        content=f"{actor} 标记反馈《{fb_title}》为已解决",
        link="/admin/feedbacks",
        exclude_user_id=current_user.id,
    )
    db.commit()
    db.refresh(feedback)
    return _serialize_feedback(feedback, include_messages=False)

@app.get("/api/feedbacks")
async def list_my_feedbacks(
    status: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Feedback)
        .filter(Feedback.user_id == current_user.id)
        .order_by(Feedback.last_message_at.desc())
    )

    if status:
        query = query.filter(Feedback.status == status)

    feedbacks = query.offset(max(offset, 0)).limit(min(max(limit, 1), 100)).all()
    return [_serialize_feedback(fb) for fb in feedbacks]

@app.get("/api/feedbacks/{feedback_id}")
async def get_my_feedback_detail(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    feedback = (
        db.query(Feedback)
        .options(
            selectinload(Feedback.messages),
            selectinload(Feedback.images),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")
    if feedback.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="无权查看该反馈")

    return _serialize_feedback(feedback, include_messages=True)

@app.get("/api/admin/feedbacks")
async def admin_list_feedbacks(
    status: Optional[str] = None,
    user_id: Optional[int] = None,
    offset: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    query = db.query(Feedback).options(selectinload(Feedback.user)).order_by(Feedback.last_message_at.desc())

    if status:
        query = query.filter(Feedback.status == status)
    if user_id:
        query = query.filter(Feedback.user_id == user_id)

    feedbacks = query.offset(max(offset, 0)).limit(min(max(limit, 1), 200)).all()
    return [_serialize_feedback(fb, include_user=True) for fb in feedbacks]

@app.get("/api/admin/feedbacks/{feedback_id}")
async def admin_get_feedback_detail(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    feedback = (
        db.query(Feedback)
        .options(
            selectinload(Feedback.user),
            selectinload(Feedback.messages),
            selectinload(Feedback.images),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    return _serialize_feedback(feedback, include_messages=True, include_user=True)

@app.post("/api/admin/feedbacks/{feedback_id}/reply")
async def admin_reply_feedback(
    feedback_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    payload = await request.json()
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="回复内容不能为空")

    new_status = payload.get("status")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    now = _now_utc_naive()
    message = FeedbackMessage(
        feedback_id=feedback.id,
        sender_id=current_user.id,
        sender_type="admin",
        content=content,
        created_at=now,
    )
    db.add(message)

    feedback.last_message_at = now
    feedback.updated_at = now
    from_status = feedback.status

    if new_status:
        if new_status not in ("pending", "replied", "closed"):
            raise HTTPException(status_code=400, detail="无效的状态")
        feedback.status = new_status
    else:
        feedback.status = "replied"

    if feedback.status != from_status:
        _add_status_event(
            db,
            feedback_id=feedback.id,
            from_status=from_status,
            to_status=feedback.status,
            changed_by_id=current_user.id,
            changed_by_type="admin",
            reason="管理员回复",
        )

    if feedback.status == "closed":
        feedback.closed_by = "admin"
        feedback.closed_at = now
    else:
        feedback.closed_by = None
        feedback.closed_at = None

    if feedback.status == "pending":
        feedback.is_resolved_by_user = False
        feedback.resolved_at = None

    fb_title = (feedback.title or "").strip() or f"反馈#{feedback.id}"
    _create_notification(
        db,
        user_id=feedback.user_id,
        type_="feedback_reply",
        content=f"管理员回复了你的反馈《{fb_title}》",
        link=f"/profile?tab=feedbacks&feedback_id={feedback.id}",
    )
    db.commit()
    db.refresh(feedback)

    try:
        actor = (current_user.username or "").strip() or f"管理员#{current_user.id}"
        text = f"管理员回复反馈 #{feedback.id}（{html_escape(actor)}）：\n{html_escape(content)}"
        await _send_telegram_message_for_feedback(db, feedback, text)
    except Exception:
        pass

    return _serialize_feedback(feedback, include_messages=True, include_user=True)

@app.put("/api/admin/feedbacks/{feedback_id}/status")
async def admin_update_feedback_status(
    feedback_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    payload = await request.json()
    status = str(payload.get("status") or "").strip()
    if status not in ("pending", "replied", "closed"):
        raise HTTPException(status_code=400, detail="无效的状态")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    from_status = feedback.status
    now = _now_utc_naive()
    feedback.status = status
    feedback.updated_at = now
    if status == "closed":
        feedback.closed_by = "admin"
        feedback.closed_at = now
    else:
        feedback.closed_by = None
        feedback.closed_at = None
    if status == "pending":
        feedback.is_resolved_by_user = False
        feedback.resolved_at = None

    if from_status != status:
        _add_status_event(
            db,
            feedback_id=feedback.id,
            from_status=from_status,
            to_status=status,
            changed_by_id=current_user.id,
            changed_by_type="admin",
            reason="管理员修改状态",
        )
    db.commit()
    db.refresh(feedback)

    return _serialize_feedback(feedback, include_messages=True, include_user=True)

@app.delete("/api/admin/feedbacks/{feedback_id}")
async def admin_delete_feedback(
    feedback_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    feedback = (
        db.query(Feedback)
        .options(selectinload(Feedback.images))
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="反馈不存在")

    db.query(TelegramFeedbackMapping).filter(TelegramFeedbackMapping.feedback_id == feedback.id).delete()
    _delete_feedback_files(feedback)
    db.delete(feedback)
    db.commit()
    return {"ok": True}

# ==========================================
# 9. 手动平台状态
# ==========================================

@app.get("/api/admin/platform-status")
async def list_locked_platform_status(
    media_type: Optional[str] = None,
    platform: Optional[str] = None,
    tmdb_id: Optional[int] = None,
    title: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)

    query = db.query(MediaPlatformStatus).filter(MediaPlatformStatus.status == "locked")

    if media_type:
        query = query.filter(MediaPlatformStatus.media_type == media_type)
    if platform:
        query = query.filter(MediaPlatformStatus.platform == platform)
    if tmdb_id is not None:
        query = query.filter(MediaPlatformStatus.tmdb_id == tmdb_id)
    if title:
        query = query.filter(MediaPlatformStatus.title_snapshot.contains(title))

    query = query.order_by(MediaPlatformStatus.last_status_changed_at.desc())

    def row_to_dict(item: MediaPlatformStatus) -> dict:
        return {
            "id": item.id,
            "media_type": item.media_type,
            "tmdb_id": item.tmdb_id,
            "title": item.title_snapshot,
            "platform": item.platform,
            "status": item.status,
            "lock_source": item.lock_source,
            "remark": item.remark,
            "failure_count": item.failure_count,
            "last_failure_status": item.last_failure_status,
            "updated_at": _to_shanghai_iso(item.last_status_changed_at),
        }

    if tmdb_id is not None:
        rows = query.all()
        total = len(rows)
        return {
            "items": [row_to_dict(item) for item in rows],
            "total": total,
            "page": 1,
            "page_size": total,
        }

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 1
    if page_size > 200:
        page_size = 200

    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [row_to_dict(item) for item in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }

class PlatformLockRequest(BaseModel):
    media_type: str
    tmdb_id: int
    platform: str
    remark: Optional[str] = None
    title: Optional[str] = None

@app.post("/api/admin/platform-status/lock")
async def manual_lock_platform(
    body: PlatformLockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)

    platform = (body.platform or "").lower()
    media_type = (body.media_type or "").lower()

    record = (
        db.query(MediaPlatformStatus)
        .filter(
            func.lower(MediaPlatformStatus.media_type) == media_type,
            MediaPlatformStatus.tmdb_id == body.tmdb_id,
            func.lower(MediaPlatformStatus.platform) == platform,
        )
        .one_or_none()
    )

    if record is None:
        record = MediaPlatformStatus(
            media_type=media_type,
            tmdb_id=body.tmdb_id,
            platform=platform,
            status="locked",
            lock_source="manual",
            remark=body.remark,
            failure_count=0,
            title_snapshot=body.title,
            last_status_changed_at=_now_utc_naive(),
            created_at=_now_utc_naive(),
        )
        db.add(record)
        from_status = None
    else:
        from_status = record.status
        record.status = "locked"
        record.lock_source = "manual"
        if body.remark is not None:
            record.remark = body.remark
        if body.title:
            record.title_snapshot = body.title
        record.last_status_changed_at = _now_utc_naive()

    log = MediaPlatformStatusLog(
        media_type=body.media_type,
        tmdb_id=body.tmdb_id,
        platform=body.platform,
        from_status=from_status,
        to_status="locked",
        change_type="manual_lock",
        reason=body.remark,
        operator_id=current_user.id,
        created_at=_now_utc_naive(),
    )
    db.add(log)

    db.commit()
    db.refresh(record)

    return {
        "ok": True,
        "record": {
            "id": record.id,
            "media_type": record.media_type,
            "tmdb_id": record.tmdb_id,
            "title": record.title_snapshot,
            "platform": record.platform,
            "status": record.status,
            "lock_source": record.lock_source,
            "remark": record.remark,
            "failure_count": record.failure_count,
            "last_failure_status": record.last_failure_status,
            "updated_at": _to_shanghai_iso(record.last_status_changed_at),
        },
    }

@app.post("/api/admin/platform-status/unlock")
async def manual_unlock_platform(
    body: PlatformLockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)

    platform = (body.platform or "").lower()
    media_type = (body.media_type or "").lower()

    record = (
        db.query(MediaPlatformStatus)
        .filter(
            func.lower(MediaPlatformStatus.media_type) == media_type,
            MediaPlatformStatus.tmdb_id == body.tmdb_id,
            func.lower(MediaPlatformStatus.platform) == platform,
        )
        .one_or_none()
    )

    if record is None:
        raise HTTPException(status_code=404, detail="记录不存在")

    from_status = record.status
    record.status = "active"
    record.lock_source = "manual"
    record.failure_count = 0
    record.last_failure_status = None
    if body.remark is not None:
        record.remark = body.remark
    record.last_status_changed_at = _now_utc_naive()

    log = MediaPlatformStatusLog(
        media_type=body.media_type,
        tmdb_id=body.tmdb_id,
        platform=body.platform,
        from_status=from_status,
        to_status="active",
        change_type="manual_unlock",
        reason=body.remark,
        operator_id=current_user.id,
        created_at=_now_utc_naive(),
    )
    db.add(log)

    db.commit()
    db.refresh(record)

    return {
        "ok": True,
        "record": {
            "id": record.id,
            "media_type": record.media_type,
            "tmdb_id": record.tmdb_id,
            "title": record.title_snapshot,
            "platform": record.platform,
            "status": record.status,
            "lock_source": record.lock_source,
            "remark": record.remark,
            "failure_count": record.failure_count,
            "last_failure_status": record.last_failure_status,
            "updated_at": _to_shanghai_iso(record.last_status_changed_at),
        },
    }

@app.get("/api/admin/platform-status/{status_id}/logs")
async def list_platform_status_logs(
    status_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)

    record = db.query(MediaPlatformStatus).filter(MediaPlatformStatus.id == status_id).one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="记录不存在")

    logs = (
        db.query(MediaPlatformStatusLog)
        .filter(
            MediaPlatformStatusLog.media_type == record.media_type,
            MediaPlatformStatusLog.tmdb_id == record.tmdb_id,
            MediaPlatformStatusLog.platform == record.platform,
        )
        .order_by(MediaPlatformStatusLog.created_at.desc())
        .all()
    )

    return [
        {
            "id": log.id,
            "from_status": log.from_status,
            "to_status": log.to_status,
            "change_type": log.change_type,
            "reason": log.reason,
            "operator_id": log.operator_id,
            "created_at": _to_shanghai_iso(log.created_at),
        }
        for log in logs
    ]

# ==========================================
# 10. 访问记录
# ==========================================

def _parse_yyyy_mm_dd(value: str) -> datetime:
    try:
        local_midnight = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=_TZ_SHANGHAI)
        return local_midnight.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        raise HTTPException(status_code=400, detail="日期格式必须是 YYYY-MM-DD")

@app.post("/api/track/detail-view")
async def track_media_detail_view(
    request: Request,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    body = await request.json()
    media_type = str(body.get("media_type") or "").strip().lower()
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type 必须是 movie 或 tv")

    title = str(body.get("title") or "").strip()
    url = str(body.get("url") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="缺少 title")
    if not url:
        raise HTTPException(status_code=400, detail="缺少 url")

    tmdb_id = body.get("tmdb_id")
    tmdb_id_int: Optional[int] = None
    if tmdb_id is not None and str(tmdb_id).strip() != "":
        try:
            tmdb_id_int = int(tmdb_id)
        except (TypeError, ValueError):
            tmdb_id_int = None

    platform_rating_fetch_statuses = body.get("platform_rating_fetch_statuses")
    platform_rating_fetch_statuses_json: Optional[str] = None
    if platform_rating_fetch_statuses is not None:
        if isinstance(platform_rating_fetch_statuses, str):
            platform_rating_fetch_statuses_json = platform_rating_fetch_statuses
        else:
            try:
                platform_rating_fetch_statuses_json = json.dumps(
                    platform_rating_fetch_statuses,
                    ensure_ascii=False,
                )
            except Exception:
                platform_rating_fetch_statuses_json = None

    log = MediaDetailAccessLog(
        user_id=current_user.id if current_user else None,
        visited_at=datetime.utcnow(),
        media_type=media_type,
        tmdb_id=tmdb_id_int,
        title=title,
        url=url,
        platform_rating_fetch_statuses=platform_rating_fetch_statuses_json,
    )
    try:
        db.add(log)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"写入详情页访问日志失败: {e}")
        raise HTTPException(status_code=500, detail="写入访问日志失败")

    return {"ok": True}

@app.get("/api/admin/detail-views")
async def admin_get_media_detail_views(
    date: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    media_type: Optional[str] = None,
    username: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 1
    if page_size > 200:
        page_size = 200

    if date and (start_date or end_date):
        raise HTTPException(status_code=400, detail="date 与 start_date/end_date 不能同时传")

    if date:
        start_dt = _parse_yyyy_mm_dd(date)
        end_dt = start_dt + timedelta(days=1)
    else:
        start_dt = _parse_yyyy_mm_dd(start_date) if start_date else None
        end_dt = (_parse_yyyy_mm_dd(end_date) + timedelta(days=1)) if end_date else None

    if media_type is not None:
        media_type = str(media_type).strip().lower()
        if media_type not in ("movie", "tv"):
            raise HTTPException(status_code=400, detail="media_type 必须是 movie 或 tv")

    q = db.query(MediaDetailAccessLog).options(selectinload(MediaDetailAccessLog.user))
    if start_dt is not None:
        q = q.filter(MediaDetailAccessLog.visited_at >= start_dt)
    if end_dt is not None:
        q = q.filter(MediaDetailAccessLog.visited_at < end_dt)
    if media_type:
        q = q.filter(MediaDetailAccessLog.media_type == media_type)
    if username:
        username = username.strip()
        if username:
            q = q.join(User, MediaDetailAccessLog.user_id == User.id).filter(
                func.lower(User.username).like(f"%{username.lower()}%")
            )

    total = q.count()
    rows = (
        q.order_by(desc(MediaDetailAccessLog.visited_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for r in rows:
        u = getattr(r, "user", None)
        statuses_raw = getattr(r, "platform_rating_fetch_statuses", None)
        statuses = None
        if statuses_raw:
            try:
                statuses = json.loads(statuses_raw)
            except Exception:
                statuses = None
        items.append(
            {
                "visited_at": _to_shanghai_iso(r.visited_at) if r.visited_at else None,
                "id": r.id,
                "media_type": r.media_type,
                "title": r.title,
                "url": r.url,
                "platform_rating_fetch_statuses": statuses,
                "user": (
                    {
                        "id": u.id,
                        "email": u.email,
                        "username": u.username,
                    }
                    if u
                    else None
                ),
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "filters": {
            "date": date,
            "start_date": start_date,
            "end_date": end_date,
            "media_type": media_type,
            "username": username,
        },
    }

@app.delete("/api/admin/detail-views/{log_id}")
async def admin_delete_media_detail_view(
    log_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    log = db.query(MediaDetailAccessLog).filter(MediaDetailAccessLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="访问记录不存在")
    db.delete(log)
    db.commit()
    return {"ok": True}

@app.post("/api/admin/detail-views/batch-delete")
async def admin_batch_delete_media_detail_views(
    body: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    ids = body.get("ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="ids 必须为非空数组")
    cleaned_ids = []
    for x in ids:
        try:
            v = int(x)
        except Exception:
            continue
        if v not in cleaned_ids:
            cleaned_ids.append(v)
    if not cleaned_ids:
        raise HTTPException(status_code=400, detail="ids 非法")

    db.query(MediaDetailAccessLog).filter(
        MediaDetailAccessLog.id.in_(cleaned_ids)
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": len(cleaned_ids)}

@app.get("/api/admin/detail-views/export")
async def admin_export_media_detail_views(
    date: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    media_type: Optional[str] = None,
    username: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    if date and (start_date or end_date):
        raise HTTPException(status_code=400, detail="date 与 start_date/end_date 不能同时传")

    if date:
        start_dt = _parse_yyyy_mm_dd(date)
        end_dt = start_dt + timedelta(days=1)
    else:
        start_dt = _parse_yyyy_mm_dd(start_date) if start_date else None
        end_dt = (_parse_yyyy_mm_dd(end_date) + timedelta(days=1)) if end_date else None

    if media_type is not None:
        media_type = str(media_type).strip().lower()
        if media_type not in ("movie", "tv"):
            raise HTTPException(status_code=400, detail="media_type 必须是 movie 或 tv")

    q = db.query(MediaDetailAccessLog)
    if start_dt is not None:
        q = q.filter(MediaDetailAccessLog.visited_at >= start_dt)
    if end_dt is not None:
        q = q.filter(MediaDetailAccessLog.visited_at < end_dt)
    if media_type:
        q = q.filter(MediaDetailAccessLog.media_type == media_type)
    if username:
        username = username.strip()
        if username:
            q = q.join(User, MediaDetailAccessLog.user_id == User.id).filter(
                func.lower(User.username).like(f"%{username.lower()}%")
            )

    total = q.count()
    max_rows = int(os.getenv("MAX_EXPORT_ROWS", "50000"))
    if total > max_rows:
        raise HTTPException(status_code=400, detail=f"数据过多（{total} 条），无法导出（限制 {max_rows} 条）")

    rows = q.order_by(MediaDetailAccessLog.visited_at.asc()).all()

    def csv_escape(value: Any) -> str:
        s = "" if value is None else str(value)
        s = s.replace('"', '""')
        if any(ch in s for ch in [",", '"', "\n", "\r"]):
            return f'"{s}"'
        return s

    def format_excel_dt(dt: Optional[datetime]) -> str:
        iso = _to_shanghai_iso(dt)
        if not iso:
            return ""
        return iso.replace("T", " ").replace("+08:00", "")

    lines = ["访问时间,影视类型,影视名称"]
    for r in rows:
        media_label = "电影" if r.media_type == "movie" else "剧集"
        lines.append(
            ",".join(
                [
                    csv_escape(format_excel_dt(r.visited_at)),
                    csv_escape(media_label),
                    csv_escape(r.title),
                ]
            )
        )

    filename_base = "detail_views"
    if date:
        filename_base += f"_{date}"
    else:
        sd = start_date or ""
        ed = end_date or ""
        filename_base += f"_{sd}_to_{ed}"

    filename_base = filename_base.replace("/", "-").replace("\\", "-")
    filename = f"{filename_base}.xls"

    content = "\ufeff" + "\n".join(lines) + "\n"
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="application/vnd.ms-excel",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ==========================================
# 11. 手动评分与榜单
# ==========================================

def _build_seasons_list(body: dict, platform: str, media_type: str) -> list:
    if media_type != "tv":
        return []
    seasons = body.get("seasons") or []
    if not isinstance(seasons, list):
        return []
    result = []
    for s in seasons:
        if not isinstance(s, dict):
            continue
        sn = s.get("season_number")
        if sn is None:
            continue
        try:
            sn = int(sn)
        except (TypeError, ValueError):
            continue
        item = {"season_number": sn}
        url = str(s.get("url") or "").strip()
        if url:
            item["url"] = url
        if platform == "douban":
            item["rating"] = str(s.get("rating") or "").strip() or "0"
            item["rating_people"] = str(s.get("rating_people") or "").strip() or "0"
        elif platform == "rottentomatoes":
            item["tomatometer"] = str(s.get("tomatometer") or "").strip() or "0"
            item["audience_score"] = str(s.get("audience_score") or "").strip() or "0"
            item["critics_avg"] = str(s.get("critics_avg") or "").strip() or "0"
            item["audience_avg"] = str(s.get("audience_avg") or "").strip() or "0"
            item["critics_count"] = str(s.get("critics_count") or "").strip() or "0"
            item["audience_count"] = str(s.get("audience_count") or "").strip() or "0"
        elif platform == "metacritic":
            item["metascore"] = str(s.get("metascore") or "").strip() or "0"
            item["userscore"] = str(s.get("userscore") or "").strip() or "0"
            item["critics_count"] = str(s.get("critics_count") or "").strip() or "0"
            item["users_count"] = str(s.get("users_count") or "").strip() or "0"
        elif platform == "tmdb":
            item["rating"] = float(s.get("rating") or 0) if s.get("rating") is not None else 0.0
            item["voteCount"] = int(s.get("vote_count") or 0) if s.get("vote_count") is not None else 0
        elif platform == "trakt":
            item["rating"] = float(s.get("rating") or 0) if s.get("rating") is not None else 0.0
            item["votes"] = int(s.get("votes") or 0) if s.get("votes") is not None else 0
        result.append(item)
    return result

def _build_manual_rating_payload(platform: str, body: dict, media_type: str):
    status = RATING_STATUS["SUCCESSFUL"]
    seasons_list = _build_seasons_list(body, platform, media_type) if media_type == "tv" else []
    url = str(body.get("url") or "").strip()
    if platform == "douban":
        base = {
            "status": status,
            "rating": str(body.get("rating") or "").strip() or "0",
            "rating_people": str(body.get("rating_people") or "").strip() or "0",
        }
        if url:
            base["url"] = url
        if media_type == "tv" and seasons_list:
            base["seasons"] = seasons_list
        return base
    if platform == "imdb":
        base = {
            "status": status,
            "rating": str(body.get("rating") or "").strip() or "0",
            "rating_people": str(body.get("rating_people") or "").strip() or "0",
        }
        if url:
            base["url"] = url
        return base
    if platform == "letterboxd":
        base = {
            "status": status,
            "rating": str(body.get("rating") or "").strip() or "0",
            "rating_count": str(body.get("rating_count") or "").strip() or "0",
            "status_widget": str(body.get("status") or "Released").strip(),
        }
        if url:
            base["url"] = url
        return base
    if platform == "rottentomatoes":
        series = {
            "tomatometer": str(body.get("tomatometer") or "").strip() or "0",
            "audience_score": str(body.get("audience_score") or "").strip() or "0",
            "critics_avg": str(body.get("critics_avg") or "").strip() or "0",
            "audience_avg": str(body.get("audience_avg") or "").strip() or "0",
            "critics_count": str(body.get("critics_count") or "").strip() or "0",
            "audience_count": str(body.get("audience_count") or "").strip() or "0",
        }
        ret = {"status": status, "series": series}
        if url:
            ret["url"] = url
        if media_type == "tv" and seasons_list:
            ret["seasons"] = seasons_list
        return ret
    if platform == "metacritic":
        overall = {
            "metascore": str(body.get("metascore") or "").strip() or "0",
            "critics_count": str(body.get("critics_count") or "").strip() or "0",
            "userscore": str(body.get("userscore") or "").strip() or "0",
            "users_count": str(body.get("users_count") or "").strip() or "0",
        }
        ret = {"status": status, "overall": overall}
        if url:
            ret["url"] = url
        if media_type == "tv" and seasons_list:
            ret["seasons"] = seasons_list
        else:
            ret["seasons"] = seasons_list or []
        return ret
    if platform == "tmdb":
        try:
            r = float(body.get("rating") or 0)
        except (TypeError, ValueError):
            r = 0.0
        try:
            vc = int(body.get("vote_count") or 0)
        except (TypeError, ValueError):
            vc = 0
        ret = {"status": status, "rating": r, "voteCount": vc}
        if url:
            ret["url"] = url
        if media_type == "tv" and seasons_list:
            ret["seasons"] = seasons_list
        return ret
    if platform == "trakt":
        try:
            r = float(body.get("rating") or 0)
        except (TypeError, ValueError):
            r = 0.0
        try:
            v = int(body.get("votes") or 0)
        except (TypeError, ValueError):
            v = 0
        ret = {"status": status, "rating": r, "votes": v, "distribution": {}}
        if url:
            ret["url"] = url
        if media_type == "tv" and seasons_list:
            ret["seasons"] = seasons_list
        return ret
    raise HTTPException(status_code=400, detail=f"不支持的平台: {platform}")

@app.put("/api/admin/ratings/manual/{media_type}/{tmdb_id}")
async def save_manual_rating(
    media_type: str,
    tmdb_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type 必须是 movie 或 tv")
    try:
        tid = int(tmdb_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="tmdb_id 必须是有效数字")
    body = await request.json()
    platform = (body.get("platform") or "").strip().lower()
    if not platform:
        raise HTTPException(status_code=400, detail="缺少 platform 参数")
    if not redis:
        raise HTTPException(status_code=503, detail="Redis 未连接，手动评分无法持久化。请启动 Redis 服务（localhost:6379）后重试。")
    payload = _build_manual_rating_payload(platform, body, media_type)
    cache_key = f"rating:{platform}:{media_type}:{tid}"
    try:
        await set_cache(cache_key, payload)
    except Exception as e:
        logger.error(f"保存手动评分到缓存失败: {e}")
        raise HTTPException(status_code=503, detail=f"缓存写入失败，请检查 Redis 连接: {str(e)}")
    all_key = f"ratings:all:{media_type}:{tid}"
    try:
        raw = await redis.get(all_key)
        if raw:
            all_data = json.loads(raw)
            if isinstance(all_data, dict):
                ratings = all_data.get("ratings")
                if isinstance(ratings, dict):
                    ratings[platform] = payload
                    await redis.setex(all_key, CACHE_EXPIRE_TIME, json.dumps(all_data))
    except Exception as e:
        logger.warning(f"更新 all 缓存时出错: {e}")
    return {"ok": True, "platform": platform, "message": "已保存"}

@app.post("/api/admin/ratings/manual")
async def create_manual_rating(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    require_admin(current_user)
    body = await request.json()
    media_type = str(body.get("media_type") or "").strip().lower()
    tmdb_id = body.get("tmdb_id")
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type 必须是 movie 或 tv")
    if tmdb_id is None:
        raise HTTPException(status_code=400, detail="缺少 tmdb_id")
    try:
        tid = int(tmdb_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="tmdb_id 必须是有效数字")
    platform = (body.get("platform") or "").strip().lower()
    if not platform:
        raise HTTPException(status_code=400, detail="缺少 platform 参数")
    if not redis:
        raise HTTPException(status_code=503, detail="Redis 未连接，手动评分无法持久化。请启动 Redis 服务（localhost:6379）后重试。")
    payload = _build_manual_rating_payload(platform, body, media_type)
    cache_key = f"rating:{platform}:{media_type}:{tid}"
    try:
        await set_cache(cache_key, payload)
    except Exception as e:
        logger.error(f"保存手动评分到缓存失败: {e}")
        raise HTTPException(status_code=503, detail=f"缓存写入失败: {str(e)}")
    all_key = f"ratings:all:{media_type}:{tid}"
    try:
        raw = await redis.get(all_key)
        if raw:
            all_data = json.loads(raw)
            if isinstance(all_data, dict):
                ratings = all_data.get("ratings")
                if isinstance(ratings, dict):
                    ratings[platform] = payload
                    await redis.setex(all_key, CACHE_EXPIRE_TIME, json.dumps(all_data))
    except Exception as e:
        logger.warning(f"更新 all 缓存时出错: {e}")
    return {"ok": True, "platform": platform, "message": "已保存"}

async def tmdb_enrich(tmdb_id: int, media_type: str):
    from ratings import _fetch_tmdb_with_language_fallback, get_tmdb_http_client
    
    try:
        client = get_tmdb_http_client()
        endpoint = f"{TMDB_API_BASE_URL}/{media_type}/{tmdb_id}"
        
        data = await _fetch_tmdb_with_language_fallback(client, endpoint)
        
        if not data:
            raise HTTPException(status_code=400, detail="TMDB 信息获取失败")
        
        title = data.get("title") if media_type == "movie" else data.get("name")
        poster_path = data.get("poster_path")
        poster = tmdb_image_poster_url(poster_path, "w500") if poster_path else ""
        original_language = data.get("original_language", "")
        
        return {
            "title": title or "", 
            "poster": poster or "", 
            "original_language": original_language or ""
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"TMDB 信息获取失败: {str(e)}")

@app.post("/api/charts/entries")
async def add_chart_entry(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    body = await request.json()
    platform = body.get("platform")
    chart_name = body.get("chart_name")
    media_type = body.get("media_type")
    tmdb_id = body.get("tmdb_id")
    rank = body.get("rank")
    title = body.get("title")
    poster = body.get("poster")

    if not (platform and chart_name and media_type in ("movie","tv") and isinstance(tmdb_id, int) and isinstance(rank, int)):
        raise HTTPException(status_code=400, detail="参数不完整")

    enrich = await tmdb_enrich(tmdb_id, media_type)
    title = title or enrich["title"]
    poster = poster or enrich["poster"]
    original_language = enrich["original_language"]

    try:
        existing = db.query(ChartEntry).filter(
            ChartEntry.platform == platform,
            ChartEntry.chart_name == chart_name,
            ChartEntry.media_type == media_type,
            ChartEntry.rank == rank,
        ).first()
        if existing:
            if existing.locked:
                raise HTTPException(status_code=423, detail="该排名已锁定，无法修改")
            existing.tmdb_id = tmdb_id
            existing.title = title
            existing.poster = poster
            existing.original_language = original_language
            existing.created_by = current_user.id
            db.commit()
            db.refresh(existing)
            return {"id": existing.id, "updated": True}

        entry = ChartEntry(
            platform=platform,
            chart_name=chart_name,
            media_type=media_type,
            tmdb_id=tmdb_id,
            title=title,
            poster=poster,
            rank=rank,
            original_language=original_language,
            created_by=current_user.id,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"保存失败或重复: {str(e)}")
    return {"id": entry.id}

@app.post("/api/charts/entries/bulk")
async def add_chart_entries_bulk(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    items = (await request.json()).get("items", [])
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="items 必须是非空数组")

    valid = []
    for item in items:
        platform = item.get("platform")
        chart_name = item.get("chart_name")
        media_type = item.get("media_type")
        tmdb_id = item.get("tmdb_id")
        rank = item.get("rank")
        title = item.get("title")
        poster = item.get("poster")
        if not (platform and chart_name and media_type in ("movie", "tv") and isinstance(tmdb_id, int) and isinstance(rank, int)):
            continue
        try:
            enrich = await tmdb_enrich(tmdb_id, media_type)
            title = title or enrich["title"]
            poster = poster or enrich["poster"]
            original_language = enrich.get("original_language", "")
            valid.append(ChartEntry(
                platform=platform,
                chart_name=chart_name,
                media_type=media_type,
                tmdb_id=tmdb_id,
                title=title,
                poster=poster,
                rank=rank,
                original_language=original_language,
                created_by=current_user.id,
            ))
        except Exception:
            continue
    if not valid:
        return {"created": []}
    try:
        db.add_all(valid)
        db.commit()
        for e in valid:
            db.refresh(e)
        created = [e.id for e in valid]
        if redis:
            try:
                await redis.delete("charts:aggregate", "charts:public")
            except Exception:
                pass
        return {"created": created}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"批量保存失败: {str(e)}")

def aggregate_top(
    db: Session,
    media_type: str,
    limit: int = 10,
    chinese_only: bool = False,
    include_pairs: list[tuple[str, str]] | None = None,
):
    sub = db.query(
        ChartEntry.platform,
        ChartEntry.chart_name,
        ChartEntry.media_type,
        ChartEntry.rank,
        func.max(ChartEntry.id).label('max_id')
    ).group_by(ChartEntry.platform, ChartEntry.chart_name, ChartEntry.media_type, ChartEntry.rank).subquery()

    entries = db.query(ChartEntry).join(
        sub,
        (ChartEntry.id == sub.c.max_id)
    ).filter(ChartEntry.media_type == media_type)
    if chinese_only:
        entries = entries.filter(ChartEntry.original_language == "zh")
    if include_pairs:
        conditions = []
        for plat, chart in include_pairs:
            conditions.append(and_(ChartEntry.platform == plat, ChartEntry.chart_name == chart))
        if conditions:
            entries = entries.filter(or_(*conditions))
    entries = entries.all()
    freq: dict[int, int] = {}
    best_rank: dict[int, int] = {}
    latest_id: dict[int, int] = {}
    sample: dict[int, ChartEntry] = {}
    for e in entries:
        key = int(e.tmdb_id)
        freq[key] = freq.get(key, 0) + 1
        best_rank[key] = min(best_rank.get(key, 9999), int(e.rank) if e.rank is not None else 9999)
        latest_id[key] = max(latest_id.get(key, 0), int(e.id))
        if key not in sample:
            sample[key] = e
    ranked_keys = sorted(freq.keys(), key=lambda k: (-freq[k], best_rank[k], -latest_id[k], k))
    result = []
    for tmdb_id in ranked_keys[:limit]:
        e = sample[int(tmdb_id)]
        poster = normalize_chart_entry_poster(e.poster or "")
        result.append({"id": e.tmdb_id, "type": media_type, "title": e.title, "poster": poster})
    return result

def latest_chart_top_by_rank(
    db: Session,
    platform: str,
    chart_name: str,
    media_type: str,
    limit: int = 10,
):
    sub = db.query(
        ChartEntry.rank,
        func.max(ChartEntry.id).label('max_id')
    ).filter(
        ChartEntry.platform == platform,
        ChartEntry.chart_name == chart_name,
        ChartEntry.media_type == media_type,
    ).group_by(ChartEntry.rank).subquery()

    rows = db.query(ChartEntry).join(sub, ChartEntry.id == sub.c.max_id).order_by(ChartEntry.rank.asc()).limit(limit).all()
    result = []
    for e in rows:
        poster = normalize_chart_entry_poster(e.poster or "")
        result.append({
            "id": e.tmdb_id,
            "type": media_type,
            "title": e.title,
            "poster": poster,
        })
    return result

@app.get("/api/charts/entries")
async def list_chart_entries(
    platform: str,
    chart_name: str,
    media_type: str,
    db: Session = Depends(get_db)
):
    if media_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="media_type 必须为 movie 或 tv")
    items = (
        db.query(ChartEntry)
        .filter(
            ChartEntry.platform == platform,
            ChartEntry.chart_name == chart_name,
            ChartEntry.media_type == media_type,
        )
        .order_by(ChartEntry.rank.asc())
        .limit(500)
        .all()
    )
    return [
        {
            "id": e.id,
            "tmdb_id": e.tmdb_id,
            "rank": e.rank,
            "title": e.title,
            "poster": e.poster,
            "locked": e.locked,
        }
        for e in items
    ]

@app.put("/api/charts/entries/lock")
async def set_entry_lock(
    platform: str,
    chart_name: str,
    media_type: str,
    rank: int,
    locked: bool,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    entry = db.query(ChartEntry).filter(
        ChartEntry.platform == platform,
        ChartEntry.chart_name == chart_name,
        ChartEntry.media_type == media_type,
        ChartEntry.rank == rank,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="条目不存在")
    entry.locked = locked
    db.commit()
    return {"rank": rank, "locked": locked}
    
@app.delete("/api/charts/entries")
async def delete_chart_entry(
    platform: str,
    chart_name: str,
    media_type: str,
    rank: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    entry = db.query(ChartEntry).filter(
        ChartEntry.platform == platform,
        ChartEntry.chart_name == chart_name,
        ChartEntry.media_type == media_type,
        ChartEntry.rank == rank,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="条目不存在")
    if entry.locked:
        raise HTTPException(status_code=423, detail="该排名已锁定，无法删除")
    db.delete(entry)
    db.commit()
    return {"deleted": True, "rank": rank}

@app.get("/api/charts/aggregate")
async def get_aggregate_charts(db: Session = Depends(get_db)):
    cache_key = "charts:aggregate"
    cached = await get_cache(cache_key)
    if cached:
        return cached

    chinese_tv = latest_chart_top_by_rank(
        db,
        platform="豆瓣",
        chart_name="一周华语剧集口碑榜",
        media_type="tv",
        limit=10,
    )

    movie_include_pairs = [
        ("豆瓣", "一周口碑榜"),
        ("IMDb", "Top 10 on IMDb this week"),
        ("烂番茄", "Popular Streaming Movies"),
        ("MTC", "Trending Movies This Week"),
        ("Letterboxd", "Popular films this week"),
        ("TMDB", "趋势本周"),
        ("Trakt", "Top Movies Last Week"),
    ]
    
    tv_include_pairs = [
        ("豆瓣", "一周全球剧集口碑榜"),
        ("烂番茄", "Popular TV"),
        ("MTC", "Trending Shows This Week"),
        ("Letterboxd", "Popular films this week"),
        ("TMDB", "趋势本周"),
        ("Trakt", "Top TV Shows Last Week"),
    ]
    
    movies = aggregate_top(db, media_type="movie", limit=10, chinese_only=False, include_pairs=movie_include_pairs)
    tv_candidates = aggregate_top(db, media_type="tv", limit=50, chinese_only=False, include_pairs=tv_include_pairs)
    tv = tv_candidates[:10]
    result = {"top_movies": movies, "top_tv": tv, "top_chinese_tv": chinese_tv}
    await set_cache(cache_key, result, expire=CHARTS_CACHE_EXPIRE)
    return result

@app.post("/api/charts/sync")
async def sync_charts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        db.query(PublicChartEntry).delete()
        db.commit()
        
        distinct_charts = db.query(
            ChartEntry.platform,
            ChartEntry.chart_name,
            ChartEntry.media_type
        ).distinct().all()
        
        synced_count = 0
        synced_at = datetime.utcnow()
        
        for platform, chart_name, media_type in distinct_charts:
            sub = db.query(
                ChartEntry.rank,
                func.max(ChartEntry.id).label('max_id')
            ).filter(
                ChartEntry.platform == platform,
                ChartEntry.chart_name == chart_name,
                ChartEntry.media_type == media_type,
            ).group_by(ChartEntry.rank).subquery()
            
            entries = db.query(ChartEntry).join(
                sub, ChartEntry.id == sub.c.max_id
            ).order_by(ChartEntry.rank.asc()).all()
            
            for entry in entries:
                public_entry = PublicChartEntry(
                    platform=entry.platform,
                    chart_name=entry.chart_name,
                    media_type=entry.media_type,
                    tmdb_id=entry.tmdb_id,
                    title=entry.title,
                    poster=entry.poster,
                    rank=entry.rank,
                    synced_at=synced_at
                )
                db.add(public_entry)
                synced_count += 1
        
        db.commit()
        if redis:
            try:
                await redis.delete("charts:aggregate", "charts:public")
            except Exception:
                pass
        return {
            "status": "success",
            "message": f"榜单数据已同步，共 {synced_count} 条记录",
            "total_count": synced_count,
            "timestamp": _to_shanghai_iso(synced_at)
        }
    except Exception as e:
        db.rollback()
        logger.error(f"同步榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"同步榜单失败: {str(e)}")

@app.get("/api/charts/public")
async def get_public_charts(db: Session = Depends(get_db)):
    cache_key = "charts:public"
    cached = await get_cache(cache_key)
    if cached is not None:
        return cached
    try:
        metacritic_top250_charts = {
            "Metacritic Best Movies of All Time",
            "Metacritic Best TV Shows of All Time",
        }

        all_entries = db.query(PublicChartEntry).order_by(
            PublicChartEntry.platform.asc(),
            PublicChartEntry.chart_name.asc(),
            PublicChartEntry.media_type.asc(),
            PublicChartEntry.rank.asc(),
        ).all()

        grouped = {}
        for e in all_entries:
            if e.chart_name in metacritic_top250_charts:
                key = (e.platform, e.chart_name)
            else:
                key = (e.platform, e.chart_name, e.media_type)
            grouped.setdefault(key, []).append(e)

        result = []
        for key, entries in grouped.items():
            if not entries:
                continue

            chart_entries = []
            for e in entries:
                poster = normalize_chart_entry_poster(e.poster or "")

                chart_entries.append(
                    {
                        "tmdb_id": e.tmdb_id,
                        "rank": e.rank,
                        "title": e.title,
                        "poster": poster,
                        "media_type": e.media_type,
                    }
                )

            if len(key) == 2:
                platform, chart_name = key
                result.append(
                    {
                        "platform": platform,
                        "chart_name": chart_name,
                        "media_type": "both",
                        "entries": chart_entries,
                    }
                )
            else:
                platform, chart_name, media_type = key
                result.append(
                    {
                        "platform": platform,
                        "chart_name": chart_name,
                        "media_type": media_type,
                        "entries": chart_entries,
                    }
                )
        
        await set_cache(cache_key, result, expire=CHARTS_CACHE_EXPIRE)
        return result
    except Exception as e:
        logger.error(f"获取公开榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取公开榜单失败: {str(e)}")

@app.get("/api/charts/detail")
async def get_chart_detail(
    platform: str,
    chart_name: str,
    db: Session = Depends(get_db)
):
    try:
        platform_map = {
            'Rotten Tomatoes': '烂番茄',
            'Metacritic': 'MTC',
        }
        backend_platform = platform_map.get(platform, platform)
        
        chart_name_map = {
            'IMDb 电影 Top 250': 'IMDb Top 250 Movies',
            'IMDb 剧集 Top 250': 'IMDb Top 250 TV Shows',
            'Letterboxd 电影 Top 250': 'Letterboxd Official Top 250',
            '豆瓣 电影 Top 250': '豆瓣 Top 250',
            'Metacritic 史上最佳电影 Top 250': 'Metacritic Best Movies of All Time',
            'Metacritic 史上最佳剧集 Top 250': 'Metacritic Best TV Shows of All Time',
            'TMDB 高分电影 Top 250': 'TMDB Top 250 Movies',
            'TMDB 高分剧集 Top 250': 'TMDB Top 250 TV Shows',
        }
        backend_chart_name = chart_name_map.get(chart_name, chart_name)
        
        entries = db.query(PublicChartEntry).filter(
            PublicChartEntry.platform == backend_platform,
            PublicChartEntry.chart_name == backend_chart_name,
        ).order_by(PublicChartEntry.rank.asc()).all()
        
        if not entries:
            entries = db.query(ChartEntry).filter(
                ChartEntry.platform == backend_platform,
                ChartEntry.chart_name == backend_chart_name,
            ).order_by(ChartEntry.rank.asc()).all()
        
        if not entries:
            raise HTTPException(status_code=404, detail="榜单数据不存在")
        
        chart_entries = []
        media_type = None
        
        metacritic_top250_charts = [
            'Metacritic Best Movies of All Time',
            'Metacritic Best TV Shows of All Time',
        ]
        is_metacritic_top250 = backend_chart_name in metacritic_top250_charts
        
        for e in entries:
            poster = normalize_chart_entry_poster(e.poster or "")
            
            entry_media_type = getattr(e, 'media_type', None)
            if not media_type and entry_media_type:
                media_type = entry_media_type
            
            chart_entries.append({
                "tmdb_id": e.tmdb_id,
                "rank": e.rank,
                "title": e.title,
                "poster": poster,
                "media_type": entry_media_type,
            })
        
        if is_metacritic_top250:
            media_type = 'both'
        elif not media_type:
            media_type = 'movie'
        
        return {
            "platform": platform,
            "chart_name": chart_name,
            "media_type": media_type,
            "entries": chart_entries
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取榜单详情失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取榜单详情失败: {str(e)}")

@app.post("/api/charts/auto-update")
async def auto_update_charts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        from chart_scrapers import ChartScraper
        
        scraper = ChartScraper(db)
        results = {}
        results['烂番茄电影'] = await scraper.update_rotten_movies()
        results['烂番茄TV'] = await scraper.update_rotten_tv()
        results['Letterboxd'] = await scraper.update_letterboxd_popular()
        results['Metacritic电影'] = await scraper.update_metacritic_movies()
        results['Metacritic剧集'] = await scraper.update_metacritic_shows()
        results['TMDB趋势'] = await scraper.update_tmdb_trending_all_week()
        results['Trakt电影'] = await scraper.update_trakt_movies_weekly()
        results['Trakt剧集'] = await scraper.update_trakt_shows_weekly()
        results['IMDb'] = await scraper.update_imdb_top10()
        results['豆瓣电影'] = await scraper.update_douban_weekly_movie()
        results['豆瓣华语剧集'] = await scraper.update_douban_weekly_chinese_tv()
        results['豆瓣全球剧集'] = await scraper.update_douban_weekly_global_tv()
        
        update_time = datetime.now(_TZ_SHANGHAI)
        update_time_utc_naive = update_time.astimezone(timezone.utc).replace(tzinfo=None)
        
        from chart_scrapers import scheduler_instance
        if scheduler_instance:
            scheduler_instance.last_update = update_time
            logger.info(f"手动更新后，更新调度器实例的last_update: {update_time}")
        
        try:
            db_status = db.query(SchedulerStatus).order_by(SchedulerStatus.updated_at.desc()).first()
            if db_status:
                db_status.last_update = update_time_utc_naive
                db.commit()
                logger.info("手动更新后，数据库中的last_update已更新")
        except Exception as db_error:
            logger.error(f"更新数据库last_update失败: {db_error}")
        
        return {
            "status": "success",
            "message": "所有榜单数据已成功更新",
            "results": results,
            "timestamp": update_time.isoformat()
        }
        
    except Exception as e:
        logger.error(f"自动更新榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"自动更新失败: {str(e)}")

@app.post("/api/charts/auto-update/{platform}")
async def auto_update_platform_charts(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        from chart_scrapers import ChartScraper
        
        scraper = ChartScraper(db)
        platform_updaters = {
            "豆瓣": [
                scraper.update_douban_weekly_movie,
                scraper.update_douban_weekly_chinese_tv,
                scraper.update_douban_weekly_global_tv
            ],
            "IMDb": [scraper.update_imdb_top10],
            "Letterboxd": [scraper.update_letterboxd_popular],
            "烂番茄": [scraper.update_rotten_movies, scraper.update_rotten_tv],
            "MTC": [scraper.update_metacritic_movies, scraper.update_metacritic_shows],
            "TMDB": [scraper.update_tmdb_trending_all_week],
            "Trakt": [scraper.update_trakt_movies_weekly, scraper.update_trakt_shows_weekly]
        }
        
        if platform not in platform_updaters:
            raise HTTPException(status_code=400, detail=f"不支持的平台: {platform}")
        
        results = {}
        for i, updater in enumerate(platform_updaters[platform]):
            count = await updater()
            results[f"{platform}_{i+1}"] = count
        
        return {
            "status": "success",
            "message": f"{platform} 平台榜单数据已成功更新",
            "platform": platform,
            "results": results,
            "timestamp": _iso_now_shanghai()
        }
        
    except Exception as e:
        logger.error(f"自动更新 {platform} 榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"自动更新 {platform} 失败: {str(e)}")

@app.post("/api/charts/update-top250")
async def update_top250_chart(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        body = await request.json()
        platform = body.get("platform")
        chart_name = body.get("chart_name")
        
        if not platform or not chart_name:
            raise HTTPException(status_code=400, detail="缺少必要参数：platform 和 chart_name")
        
        from chart_scrapers import ChartScraper
        
        scraper = ChartScraper(db)
        top250_updaters = {
            "TMDB": {
                "TMDB Top 250 Movies": scraper.update_tmdb_top250_movies,
                "TMDB Top 250 TV Shows": scraper.update_tmdb_top250_tv,
            },
            "IMDb": {
                "IMDb Top 250 Movies": scraper.update_imdb_top250_movies,
                "IMDb Top 250 TV Shows": scraper.update_imdb_top250_tv,
            },
            "Letterboxd": {
                "Letterboxd Official Top 250": scraper.update_letterboxd_top250,
            },
            "豆瓣": {
                "豆瓣 Top 250": scraper.update_douban_top250,
            },
            "MTC": {
                "Metacritic Best Movies of All Time": scraper.update_metacritic_best_movies,
                "Metacritic Best TV Shows of All Time": scraper.update_metacritic_best_tv,
            },
            # "Trakt": {
            #     "Trakt Highest Rated Movies (Top 250)": scraper.update_trakt_top250_movies,
            #     "Trakt Highest Rated TV Shows (Top 250)": scraper.update_trakt_top250_tv,
            # },
        }
        
        if platform not in top250_updaters:
            raise HTTPException(status_code=400, detail=f"平台 {platform} 暂不支持 Top 250 榜单更新")
        
        if chart_name not in top250_updaters[platform]:
            raise HTTPException(status_code=400, detail=f"平台 {platform} 不支持榜单: {chart_name}")
        
        updater = top250_updaters[platform][chart_name]
        
        if platform == "豆瓣" and chart_name == "豆瓣 Top 250":
            douban_cookie = current_user.douban_cookie if current_user.douban_cookie else None
            count = await updater(douban_cookie=douban_cookie)
        else:
            count = await updater()
        
        return {
            "status": "success",
            "message": f"{platform} - {chart_name} 更新成功",
            "platform": platform,
            "chart_name": chart_name,
            "count": count,
            "timestamp": _iso_now_shanghai()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "ANTI_SCRAPING_DETECTED" in error_msg:
            logger.warning(f"更新 Top 250 榜单遇到反爬虫机制: {e}")
            raise HTTPException(
                status_code=428,
                detail={
                    "error": "ANTI_SCRAPING_DETECTED",
                    "message": "遇到反爬虫机制，请验证",
                    "platform": platform,
                    "chart_name": chart_name
                }
            )
        logger.error(f"更新 Top 250 榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")

@app.post("/api/charts/clear/{platform}")
async def clear_platform_charts(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        top250_chart_names = [
            "IMDb Top 250 Movies",
            "IMDb Top 250 TV Shows",
            "Letterboxd Official Top 250",
            "豆瓣 Top 250",
            "Metacritic Best Movies of All Time",
            "Metacritic Best TV Shows of All Time",
            "TMDB Top 250 Movies",
            "TMDB Top 250 TV Shows",
        ]
        
        deleted_count = db.query(ChartEntry).filter(
            ChartEntry.platform == platform,
            ~ChartEntry.chart_name.in_(top250_chart_names)
        ).delete()
        db.commit()
        
        return {
            "status": "success",
            "message": f"已清空 {platform} 平台的所有榜单（Top 250 榜单除外），共删除 {deleted_count} 条记录",
            "deleted_count": deleted_count,
            "timestamp": _iso_now_shanghai()
        }
    except Exception as e:
        logger.error(f"清空 {platform} 平台榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"清空榜单失败: {str(e)}")

@app.post("/api/charts/clear-top250")
async def clear_top250_chart(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        body = await request.json()
        platform = body.get("platform")
        chart_name = body.get("chart_name")
        
        if not platform or not chart_name:
            raise HTTPException(status_code=400, detail="缺少必要参数：platform 和 chart_name")
        
        deleted_count = db.query(ChartEntry).filter(
            ChartEntry.platform == platform,
            ChartEntry.chart_name == chart_name
        ).delete()
        db.commit()
        
        return {
            "status": "success",
            "message": f"已清空 {platform} - {chart_name}，共删除 {deleted_count} 条记录",
            "platform": platform,
            "chart_name": chart_name,
            "deleted_count": deleted_count,
            "timestamp": _iso_now_shanghai()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"清空 Top 250 榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"清空失败: {str(e)}")

@app.post("/api/charts/clear-all")
async def clear_all_charts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        top250_chart_names = [
            "IMDb Top 250 Movies",
            "IMDb Top 250 TV Shows",
            "Letterboxd Official Top 250",
            "豆瓣 Top 250",
            "Metacritic Best Movies of All Time",
            "Metacritic Best TV Shows of All Time",
            "TMDB Top 250 Movies",
            "TMDB Top 250 TV Shows",
        ]
        
        deleted_count = db.query(ChartEntry).filter(
            ~ChartEntry.chart_name.in_(top250_chart_names)
        ).delete()
        db.commit()
        
        return {
            "status": "success",
            "message": f"已清空所有平台的所有榜单（Top 250 榜单除外），共删除 {deleted_count} 条记录",
            "deleted_count": deleted_count,
            "timestamp": _iso_now_shanghai()
        }
    except Exception as e:
        logger.error(f"清空所有榜单失败: {e}")
        raise HTTPException(status_code=500, detail=f"清空所有榜单失败: {str(e)}")

@app.post("/api/scheduler/test-notification")
async def test_notification(
    current_user: User = Depends(get_current_user)
):
    require_admin(current_user)
    
    try:
        from chart_scrapers import telegram_notifier
        success = await telegram_notifier.send_message(
            "🧪 *测试通知*\n\n这是一条测试消息，用于验证Telegram通知功能是否正常工作。"
        )
        
        if success:
            return {
                "status": "success",
                "message": "测试通知发送成功"
            }
        else:
            return {
                "status": "error",
                "message": "测试通知发送失败，请检查Telegram配置"
            }
    except Exception as e:
        logger.error(f"测试通知失败: {e}")
        raise HTTPException(status_code=500, detail=f"测试通知失败: {str(e)}")

@app.get("/api/charts/status")
async def get_charts_status(db: Session = Depends(get_db)):
    try:
        platforms = ["豆瓣", "IMDb", "Letterboxd", "烂番茄", "MTC"]
        status = {}
        
        for platform in platforms:
            latest_entries = db.query(
                ChartEntry.platform,
                ChartEntry.chart_name,
                ChartEntry.media_type,
                func.max(ChartEntry.created_at).label('latest_update')
            ).filter(
                ChartEntry.platform == platform
            ).group_by(
                ChartEntry.platform,
                ChartEntry.chart_name,
                ChartEntry.media_type
            ).all()
            
            platform_status = []
            for entry in latest_entries:
                count = db.query(ChartEntry).filter(
                    ChartEntry.platform == entry.platform,
                    ChartEntry.chart_name == entry.chart_name,
                    ChartEntry.media_type == entry.media_type
                ).count()
                
                platform_status.append({
                    "chart_name": entry.chart_name,
                    "media_type": entry.media_type,
                    "count": count,
                    "last_updated": _to_shanghai_iso(entry.latest_update) if entry.latest_update else None
                })
            
            status[platform] = platform_status
        
        return {
            "status": "success",
            "data": status,
            "timestamp": _iso_now_shanghai()
        }
        
    except Exception as e:
        logger.error(f"获取榜单状态失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取榜单状态失败: {str(e)}")

scheduler_lock_file = None

def acquire_scheduler_lock():
    global scheduler_lock_file

    lock_path = "/tmp/ratefuse_scheduler.lock"
    scheduler_lock_file = open(lock_path, "w")

    try:
        fcntl.flock(scheduler_lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(f"进程 {os.getpid()} 获得 scheduler 锁")
        return True
    except BlockingIOError:
        print(f"进程 {os.getpid()} 未获得锁")
        return False

@app.post("/api/scheduler/start")
async def start_scheduler_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        from chart_scrapers import start_auto_scheduler
        logger.info(f"用户 {current_user.email} 尝试启动调度器")
        
        scheduler = await start_auto_scheduler(db_session=db)
        scheduler_status = scheduler.get_status()
        logger.info(f"调度器启动成功，状态: {scheduler_status}")
        
        db_status = SchedulerStatus(
            running=True,
            next_update=_parse_iso_to_utc_naive(scheduler_status.get("next_update")),
            last_update=_parse_iso_to_utc_naive(scheduler_status.get("last_update")),
        )
        db.add(db_status)
        db.commit()
        logger.info("数据库状态已更新")
        
        return {
            "status": "success",
            "message": "定时任务调度器已启动",
            "timestamp": _iso_now_shanghai(),
            "scheduler_status": scheduler_status
        }
    except Exception as e:
        logger.error(f"启动调度器失败: {e}")
        import traceback
        logger.error(f"详细错误信息: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"启动调度器失败: {str(e)}")

@app.post("/api/scheduler/stop")
async def stop_scheduler_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    require_admin(current_user)
    
    try:
        from chart_scrapers import stop_auto_scheduler
        await stop_auto_scheduler()
        
        db_status = SchedulerStatus(
            running=False,
            next_update=None,
            last_update=None
        )
        db.add(db_status)
        db.commit()
        logger.info("调度器已停止，数据库状态已更新")
        
        return {
            "status": "success",
            "message": "定时任务调度器已停止",
            "timestamp": _iso_now_shanghai()
        }
    except Exception as e:
        logger.error(f"停止调度器失败: {e}")
        raise HTTPException(status_code=500, detail=f"停止调度器失败: {str(e)}")

def calculate_next_update():
    from datetime import timezone, timedelta
    beijing_tz = timezone(timedelta(hours=8))
    now_beijing = datetime.now(beijing_tz)
    today_2130 = now_beijing.replace(hour=21, minute=30, second=0, microsecond=0)
    
    if now_beijing >= today_2130:
        next_update = today_2130 + timedelta(days=1)
    else:
        next_update = today_2130
    
    return next_update

@app.get("/api/scheduler/status")
async def get_scheduler_status_endpoint(db: Session = Depends(get_db)):
    try:
        from chart_scrapers import scheduler_instance
        if scheduler_instance and scheduler_instance.running:
            status = scheduler_instance.get_status()
            logger.debug(f"从内存调度器实例获取状态: {status}")
            return {
                "status": "success",
                "data": status,
                "timestamp": _iso_now_shanghai()
            }
        
        db_status = db.query(SchedulerStatus).order_by(SchedulerStatus.updated_at.desc()).first()
        
        if db_status:
            logger.debug(f"从数据库获取调度器状态: running={db_status.running}")
            next_update = calculate_next_update()
            return {
                "status": "success",
                "data": {
                    "running": db_status.running,
                    "next_update": next_update.isoformat(),
                    "last_update": _to_shanghai_iso(db_status.last_update) if db_status.last_update else None
                },
                "timestamp": _iso_now_shanghai()
            }
        else:
            from chart_scrapers import get_scheduler_status
            status = get_scheduler_status()
            logger.debug(f"从内存获取调度器状态: {status}")
            return {
                "status": "success",
                "data": status,
                "timestamp": _iso_now_shanghai()
            }
    except Exception as e:
        logger.error(f"获取调度器状态失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取调度器状态失败: {str(e)}")

@app.get("/api/health")
async def health_check():
    redis_status = "healthy" if redis else "unhealthy"
    
    browser_pool_stats = browser_pool.get_stats()
    browser_pool_status = "healthy" if browser_pool.initialized else "unhealthy"
    
    return {
        "status": "ok",
        "redis": redis_status,
        "browser_pool": browser_pool_status,
        "browser_pool_stats": browser_pool_stats
    }

# ==========================================
# 11. 应用启动和关闭事件
# ==========================================

@app.on_event("startup")
async def startup_event():
    global redis
    try:
        MediaDetailAccessLog.__table__.create(bind=engine, checkfirst=True)
    except Exception as e:
        logger.error(f"创建 media_detail_access_logs 表失败（可能无权限/连接异常）: {e}")
    try:
        redis = await aioredis.from_url(
            REDIS_URL,
            encoding='utf-8',
            decode_responses=True
        )
        logger.info("Redis连接成功")
    except Exception as e:
        logger.error(f"Redis 连接初始化失败: {e}")
        redis = None
    
    try:
        BROWSER_POOL_SIZE = int(os.getenv("BROWSER_POOL_SIZE", "5"))
        BROWSER_POOL_CONTEXTS = int(os.getenv("BROWSER_POOL_CONTEXTS", "3"))
        BROWSER_POOL_PAGES = int(os.getenv("BROWSER_POOL_PAGES", "5"))
        
        browser_pool.max_browsers = BROWSER_POOL_SIZE
        browser_pool.max_contexts_per_browser = BROWSER_POOL_CONTEXTS
        browser_pool.max_pages_per_context = BROWSER_POOL_PAGES
        
        await browser_pool.initialize()
        logger.info(f"浏览器池初始化成功，共 {BROWSER_POOL_SIZE} 个浏览器实例")
    except Exception as e:
        logger.error(f"浏览器池初始化失败: {e}")
    
    if os.getenv("ENV") != "development":
        try:
            from chart_scrapers import start_auto_scheduler
            if acquire_scheduler_lock():
                await start_auto_scheduler()
                logger.info("生产环境：定时调度器已自动启动")
            else:
               logger.info("scheduler 已在其他 worker 运行，跳过启动")
        except Exception as e:
            logger.error(f"生产环境：自动启动调度器失败: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    try:
        await browser_pool.cleanup()
        print("浏览器池已清理")
    except Exception as e:
        print(f"浏览器池清理失败: {e}")
    
    global _tmdb_client
    if _tmdb_client and not _tmdb_client.is_closed:
        try:
            await _tmdb_client.aclose()
            print("TMDB 客户端连接池已关闭")
        except Exception as e:
            print(f"TMDB 客户端清理失败: {e}")
            
