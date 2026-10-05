import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from .database import PostgresDatabase, database


def reserve_ai_call(user_id):
    now = datetime.now(timezone.utc)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month = day.replace(day=1)
    next_month = (month + timedelta(days=32)).replace(day=1)
    minute = now.replace(second=0, microsecond=0)
    buckets = [
        (f"minute:{user_id}:{minute.isoformat()}", "AI_USER_MINUTE_LIMIT", 10, minute + timedelta(minutes=1)),
        (f"user:{user_id}:{day.date()}", "AI_USER_DAILY_LIMIT", 20, day + timedelta(days=1)),
        (f"day:{day.date()}", "AI_GLOBAL_DAILY_LIMIT", 100, day + timedelta(days=1)),
        (f"month:{month.date()}", "AI_GLOBAL_MONTHLY_LIMIT", 1000, next_month),
    ]
    with database() as db:
        # 複数ワーカーからの同時要求でも全体の上限を超えないよう予約する。
        if isinstance(db, PostgresDatabase):
            db.execute("SELECT pg_advisory_xact_lock(73120404)")
        else:
            db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM ai_usage WHERE expires_at<=?", (now.timestamp(),))
        for bucket, variable, default, expires in buckets:
            limit = max(0, int(os.getenv(variable, str(default))))
            row = db.execute("SELECT count FROM ai_usage WHERE bucket=?", (bucket,)).fetchone()
            if limit == 0 or (row and row["count"] >= limit):
                raise HTTPException(429, "AI提案の利用上限に達しました。時間をおいて再試行してください。",
                                    headers={"Retry-After": str(max(1, int((expires - now).total_seconds())))})
        for bucket, _, _, expires in buckets:
            db.execute("INSERT INTO ai_usage VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=ai_usage.count+1",
                       (bucket, expires.timestamp()))
    # 外部で課金された可能性があるため、失敗・タイムアウト時も予約は戻さない。
