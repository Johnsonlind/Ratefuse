# ==========================================
# 数据模型层（ORM）
# ==========================================
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Boolean, Text, UniqueConstraint, text, BigInteger
from sqlalchemy.orm import sessionmaker, relationship, declarative_base
from sqlalchemy.dialects.mysql import LONGTEXT
from datetime import datetime

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv("SQLALCHEMY_DATABASE_URL", "")
if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError("缺少环境变量 SQLALCHEMY_DATABASE_URL，请在 .env 中配置数据库连接串")
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    username = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255))
    avatar = Column(LONGTEXT, nullable=True) 
    created_at = Column(DateTime, default=datetime.utcnow)
    is_admin = Column(Boolean, default=False)
    is_banned = Column(Boolean, default=False, index=True)
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
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
    created_at = Column(DateTime, default=datetime.utcnow)
    
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
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
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
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    __table_args__ = (
        UniqueConstraint('platform', 'chart_name', 'media_type', 'rank', name='uq_public_chart_item'),
    )

class PasswordReset(Base):
    __tablename__ = "password_resets"
    
    id = Column(Integer, primary_key=True)
    email = Column(String(255), index=True)
    token = Column(String(255), unique=True)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    used = Column(Boolean, default=False)

class Follow(Base):
    __tablename__ = "follows"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    follower_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    following_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=text('UTC_TIMESTAMP()'))
    
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
    updated_at = Column(DateTime, server_default=text('UTC_TIMESTAMP()'), onupdate=text('UTC_TIMESTAMP()'))

class MediaDetailAccessLog(Base):
    __tablename__ = "media_detail_access_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    visited_at = Column(DateTime, default=datetime.utcnow, index=True)
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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    last_message_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    feedback = relationship("Feedback", back_populates="messages")
    sender = relationship("User")

class FeedbackImage(Base):
    __tablename__ = "feedback_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(Integer, ForeignKey("feedback.id"), nullable=False, index=True)
    image_path = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

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
    last_status_changed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    
