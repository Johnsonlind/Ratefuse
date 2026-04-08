# ==========================================
# 数据模型层（ORM）
# ==========================================
import os
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean, Text, UniqueConstraint, text, BigInteger, Enum, Float
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from sqlalchemy.pool import QueuePool
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.engine import Engine
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo

load_dotenv()

def _ensure_mysql_utf8mb4(url: str) -> str:
    if not url or not url.startswith("mysql+"):
        return url
    parsed = urlparse(url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    enc = (q.get("charset") or "").lower()
    if enc not in ("utf8mb4", "utf8"):
        q["charset"] = "utf8mb4"
    return urlunparse(parsed._replace(query=urlencode(q)))

SQLALCHEMY_DATABASE_URL = _ensure_mysql_utf8mb4(
    (os.getenv("SQLALCHEMY_DATABASE_URL") or "").strip()
)
if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError("缺少环境变量 SQLALCHEMY_DATABASE_URL，请在 .env 中配置数据库连接串")
_engine_kwargs = dict(
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800,
)
if SQLALCHEMY_DATABASE_URL.startswith("mysql+"):
    _engine_kwargs["connect_args"] = {"init_command": "SET time_zone='+08:00'"}

engine = create_engine(SQLALCHEMY_DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

_TZ_SHANGHAI = ZoneInfo("Asia/Shanghai")

def _shanghai_naive_now() -> datetime:
    return datetime.now(_TZ_SHANGHAI).replace(tzinfo=None)

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    username = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255))
    avatar = Column(LONGTEXT, nullable=True) 
    created_at = Column(DateTime, default=_shanghai_naive_now)
    is_admin = Column(Boolean, default=False)
    is_banned = Column(Boolean, default=False, index=True)
    is_member = Column(Boolean, default=False, nullable=False, index=True)
    member_expired_at = Column(DateTime, nullable=True, index=True)
    douban_cookie = Column(Text, nullable=True)

    favorites = relationship("Favorite", back_populates="user")
    favorite_lists = relationship("FavoriteList", back_populates="user")
    following = relationship("Follow", foreign_keys="Follow.follower_id", back_populates="follower")
    followers = relationship("Follow", foreign_keys="Follow.following_id", back_populates="following")

class FavoriteList(Base):
    __tablename__ = "favorite_lists"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String(255))
    description = Column(Text, nullable=True)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_shanghai_naive_now)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now)
    original_list_id = Column(Integer, ForeignKey("favorite_lists.id"), nullable=True)
    
    user = relationship("User", back_populates="favorite_lists")
    favorites = relationship("Favorite", back_populates="favorite_list")

class Favorite(Base):
    __tablename__ = "favorites"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    list_id = Column(Integer, ForeignKey("favorite_lists.id", ondelete="CASCADE"))
    media_id = Column(String)
    media_type = Column(String)
    title = Column(String)
    poster = Column(String)
    year = Column(String)
    overview = Column(Text)
    note = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=_shanghai_naive_now)
    
    user = relationship("User", back_populates="favorites")
    favorite_list = relationship("FavoriteList", back_populates="favorites")

class ChartEntry(Base):
    __tablename__ = "chart_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(50), index=True)
    chart_name = Column(String(100), index=True)
    media_type = Column(String(10), index=True)
    tmdb_id = Column(Integer, index=True)
    title = Column(String(255))
    poster = Column(Text)
    rank = Column(Integer, index=True)
    original_language = Column(String(10), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=_shanghai_naive_now, index=True)
    locked = Column(Boolean, default=False, index=True)
    
    user = relationship("User")
    __table_args__ = (
        UniqueConstraint('platform', 'chart_name', 'media_type', 'tmdb_id', 'rank', name='uq_chart_item'),
    )

class PublicChartEntry(Base):
    __tablename__ = "public_chart_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String(50), index=True)
    chart_name = Column(String(100), index=True)
    media_type = Column(String(10), index=True)
    tmdb_id = Column(Integer, index=True)
    title = Column(String(255))
    poster = Column(Text)
    rank = Column(Integer, index=True)
    synced_at = Column(DateTime, default=_shanghai_naive_now, index=True)
    
    __table_args__ = (
        UniqueConstraint('platform', 'chart_name', 'media_type', 'rank', name='uq_public_chart_item'),
    )

class PasswordReset(Base):
    __tablename__ = "password_resets"
    
    id = Column(Integer, primary_key=True)
    email = Column(String(255), index=True)
    token = Column(String(255), unique=True)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=_shanghai_naive_now)
    used = Column(Boolean, default=False)

class Follow(Base):
    __tablename__ = "follows"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    follower_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    following_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False)
    
    __table_args__ = (
        UniqueConstraint('follower_id', 'following_id', name='follower_id'),
    )
    
    follower = relationship("User", foreign_keys=[follower_id], back_populates="following")
    following = relationship("User", foreign_keys=[following_id], back_populates="followers")

class SchedulerStatus(Base):
    __tablename__ = "scheduler_status"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    running = Column(Boolean, default=False, nullable=False)
    last_update = Column(DateTime, nullable=True)
    next_update = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now, nullable=False)

class MediaDetailAccessLog(Base):
    __tablename__ = "media_detail_access_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    visited_at = Column(DateTime, default=_shanghai_naive_now, index=True)
    media_type = Column(String(10), nullable=False, index=True)
    tmdb_id = Column(Integer, nullable=True, index=True)
    title = Column(String(255), nullable=False)
    url = Column(Text, nullable=False)
    platform_rating_fetch_statuses = Column(Text, nullable=True)
    
    user = relationship("User")

class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    is_resolved_by_user = Column(Boolean, default=False, nullable=False, index=True)
    resolved_at = Column(DateTime, nullable=True, index=True)
    closed_by = Column(String(20), nullable=True)
    closed_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now, nullable=False)
    last_message_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

    user = relationship("User")
    messages = relationship("FeedbackMessage", back_populates="feedback", cascade="all, delete-orphan")
    images = relationship("FeedbackImage", back_populates="feedback", cascade="all, delete-orphan")
    status_events = relationship("FeedbackStatusEvent", back_populates="feedback", cascade="all, delete-orphan")


class TelegramFeedbackMapping(Base):
    __tablename__ = "telegram_feedback_mappings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=False, index=True)
    telegram_chat_id = Column(BigInteger, nullable=False)
    telegram_message_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now, nullable=False)

    feedback = relationship("Feedback")

    __table_args__ = (
        UniqueConstraint("feedback_id", "telegram_chat_id", name="uq_feedback_chat"),
    )

class FeedbackMessage(Base):
    __tablename__ = "feedback_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    sender_type = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

    feedback = relationship("Feedback", back_populates="messages")
    sender = relationship("User")

class FeedbackImage(Base):
    __tablename__ = "feedback_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=False, index=True)
    image_path = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False)

    feedback = relationship("Feedback", back_populates="images")

class FeedbackStatusEvent(Base):
    __tablename__ = "feedback_status_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=False, index=True)
    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    changed_by_type = Column(String(20), nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

    feedback = relationship("Feedback", back_populates="status_events")
    changed_by = relationship("User")

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(50), nullable=False, index=True)
    content = Column(Text, nullable=False)
    link = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False, index=True)
    read_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

    user = relationship("User")

class MediaPlatformStatus(Base):
    __tablename__ = "media_platform_status"

    id = Column(Integer, primary_key=True, autoincrement=True)

    media_type = Column(String(10), nullable=False, index=True)
    tmdb_id = Column(Integer, nullable=False, index=True)
    platform = Column(String(50), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="active", index=True)
    lock_source = Column(String(20), nullable=True)
    remark = Column(Text, nullable=True)

    failure_count = Column(Integer, nullable=False, default=0)
    last_failure_status = Column(String(30), nullable=True)

    title_snapshot = Column(String(255), nullable=True)
    last_status_changed_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("media_type", "tmdb_id", "platform", name="uq_media_platform_status"),
    )

class MediaPlatformStatusLog(Base):
    __tablename__ = "media_platform_status_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)

    media_type = Column(String(10), nullable=False, index=True)
    tmdb_id = Column(Integer, nullable=False, index=True)
    platform = Column(String(50), nullable=False, index=True)

    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=False)
    change_type = Column(String(30), nullable=False)
    reason = Column(Text, nullable=True)

    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    operator = relationship("User")

    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

class MediaLinkMapping(Base):
    __tablename__ = "media_link_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)

    tmdb_id = Column(Integer, nullable=False, unique=True, index=True)
    media_type = Column(Enum("movie", "tv", name="media_link_mapping_media_type"), nullable=False, index=True)
    title = Column(String(255), nullable=True, index=True)
    year = Column(Integer, nullable=True, index=True)
    imdb_id = Column(String(50), nullable=True, index=True)

    douban_id = Column(String(50), nullable=True, index=True)
    douban_url = Column(Text, nullable=True)
    douban_seasons_json = Column(LONGTEXT, nullable=True)
    douban_seasons_ids_json = Column(LONGTEXT, nullable=True)
    letterboxd_url = Column(Text, nullable=True)
    letterboxd_slug = Column(String(255), nullable=True, index=True)
    rotten_tomatoes_url = Column(Text, nullable=True)
    rotten_tomatoes_slug = Column(String(255), nullable=True, index=True)
    rotten_tomatoes_seasons_json = Column(LONGTEXT, nullable=True)
    metacritic_url = Column(Text, nullable=True)
    metacritic_slug = Column(String(255), nullable=True, index=True)
    metacritic_seasons_json = Column(LONGTEXT, nullable=True)

    match_status = Column(
        Enum("auto", "manual", "conflict", name="media_link_mapping_match_status"),
        nullable=False,
        default="auto",
        index=True,
    )
    confidence = Column(Float, nullable=True)
    last_verified_at = Column(DateTime, nullable=True, index=True)

    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)
    updated_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

class ResourceEntry(Base):
    __tablename__ = "resource_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    media_type = Column(String(10), nullable=False, index=True)
    tmdb_id = Column(Integer, nullable=False, index=True)
    media_title = Column(String(255), nullable=False)
    media_year = Column(Integer, nullable=True)
    resource_type = Column(
        Enum("baidu", "quark", "xunlei", "115", "uc", "ali", "magnet", name="resource_type_enum"),
        nullable=False,
        index=True,
    )
    link = Column(Text, nullable=False)
    extraction_code = Column(String(255), nullable=True)
    agreement_confirmed = Column(Boolean, nullable=False, default=False)
    status = Column(
        Enum("pending", "approved", "rejected", name="resource_status_enum"),
        nullable=False,
        default="pending",
        index=True,
    )
    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at = Column(DateTime, nullable=True, index=True)
    reject_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now, nullable=False, index=True)

    submitter = relationship("User", foreign_keys=[submitted_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])

    __table_args__ = (
        UniqueConstraint("media_type", "tmdb_id", "resource_type", "status", name="uq_resource_media_type_status"),
    )

class ResourceFavorite(Base):
    __tablename__ = "resource_favorites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    resource_id = Column(Integer, ForeignKey("resource_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)

    user = relationship("User")
    resource = relationship("ResourceEntry")

    __table_args__ = (
        UniqueConstraint("user_id", "resource_id", name="uq_resource_favorite"),
    )

class PaymentOrder(Base):
    __tablename__ = "payment_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Integer, nullable=False)
    status = Column(
        Enum("pending", "paid", "failed", name="payment_order_status_enum"),
        nullable=False,
        default="pending",
        index=True,
    )
    created_at = Column(DateTime, default=_shanghai_naive_now, nullable=False, index=True)
    updated_at = Column(DateTime, default=_shanghai_naive_now, onupdate=_shanghai_naive_now, nullable=False, index=True)

    user = relationship("User")

def _ensure_users_table_columns(engine: Engine) -> None:
    if engine.dialect.name != "mysql":
        return

    db_name = engine.url.database
    if not db_name:
        return

    def _has_column(conn, table: str, column: str) -> bool:
        exists = conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = :schema
                  AND TABLE_NAME = :table
                  AND COLUMN_NAME = :column
                LIMIT 1
                """
            ),
            {"schema": db_name, "table": table, "column": column},
        ).first()
        return bool(exists)

    with engine.begin() as conn:
        if not _has_column(conn, "users", "is_member"):
            conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN is_member BOOLEAN NOT NULL DEFAULT 0, "
                    "ADD INDEX idx_users_is_member (is_member)"
                )
            )

        if not _has_column(conn, "users", "member_expired_at"):
            conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN member_expired_at DATETIME NULL, "
                    "ADD INDEX idx_users_member_expired_at (member_expired_at)"
                )
            )

def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_users_table_columns(engine)

if __name__ == "__main__":
    init_db()
    