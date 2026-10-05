from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import AwareDatetime, BaseModel, Field, model_validator

from .auth import User
from .database import database

router = APIRouter(prefix="/api/calendar")


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


class BusyEvent(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def check_range(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("終了時刻は開始時刻より後にしてください。")
        return self


class CalendarImport(BaseModel):
    window_start: AwareDatetime
    window_end: AwareDatetime
    events: list[BusyEvent] = Field(max_length=2000)

    @model_validator(mode="after")
    def check_window(self):
        if not timedelta(0) < self.window_end - self.window_start <= timedelta(days=32):
            raise ValueError("同期範囲は32日以内にしてください。")
        if len({e.key for e in self.events}) != len(self.events):
            raise ValueError("予定の識別子が重複しています。")
        if any(e.ends_at <= self.window_start or e.starts_at >= self.window_end for e in self.events):
            raise ValueError("同期範囲外の予定です。")
        return self


@router.get("")
def get_calendar(user: User):
    with database() as db:
        sync = db.execute("SELECT synced_at,window_start,window_end FROM calendar_sync WHERE user_id=?", (user["id"],)).fetchone()
        events = [dict(r) for r in db.execute("SELECT event_key,starts_at,ends_at FROM calendar_events WHERE user_id=? ORDER BY starts_at", (user["id"],))]
    return {"sync": dict(sync) if sync else None, "events": events}


@router.put("")
def import_calendar(data: CalendarImport, user: User):
    # 端末カレンダーへの書き込みは行わず、本人の取り込み済みスナップショットのみ更新する。
    with database() as db:
        db.execute("DELETE FROM calendar_events WHERE user_id=?", (user["id"],))
        db.executemany("INSERT INTO calendar_events VALUES (?,?,?,?)", [(user["id"], e.key, iso(e.starts_at), iso(e.ends_at)) for e in data.events])
        db.execute("INSERT INTO calendar_sync VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET synced_at=excluded.synced_at,window_start=excluded.window_start,window_end=excluded.window_end", (user["id"], iso(datetime.now(timezone.utc)), iso(data.window_start), iso(data.window_end)))
    return get_calendar(user)


@router.delete("")
def disconnect(user: User):
    with database() as db:
        db.execute("DELETE FROM calendar_events WHERE user_id=?", (user["id"],))
        db.execute("DELETE FROM calendar_sync WHERE user_id=?", (user["id"],))
    return {"message": "取り込んだ予定を解除しました。端末の予定は変更していません。"}


def free_minutes(user, limit, now=None):
    now = now or datetime.now(timezone.utc)
    data = get_calendar(user)
    sync = data["sync"]
    if not sync or not datetime.fromisoformat(sync["window_start"]) <= now < datetime.fromisoformat(sync["window_end"]):
        raise HTTPException(409, "カレンダーの同期範囲が古くなっています。再度取り込んでください。")
    if now - datetime.fromisoformat(sync["synced_at"]) > timedelta(hours=24):
        raise HTTPException(409, "予定の取り込みから24時間以上経過しています。再度取り込んでください。")
    end = min(now + timedelta(minutes=limit), datetime.fromisoformat(sync["window_end"]))
    for event in data["events"]:
        start, finish = datetime.fromisoformat(event["starts_at"]), datetime.fromisoformat(event["ends_at"])
        if start <= now < finish:
            return 0
        if now < start < end:
            end = start
    return max(0, int((end - now).total_seconds() // 60))
