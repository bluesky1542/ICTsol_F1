from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter

from .auth import User
from .database import database
from .models import ReflectionInput, WorkPlanInput

router = APIRouter(prefix="/api/reflections")
JAPAN = timezone(timedelta(hours=9))
COLUMNS = "day,achievement,satisfaction,tiredness,comment,updated_at"


def today(now=None):
    # 調子の有効期限と同じく、日本時間の日付で1日を区切る。
    return (now or datetime.now(timezone.utc)).astimezone(JAPAN).date().isoformat()


@router.get("")
def list_reflections(user: User):
    with database() as db:
        return [dict(row) for row in db.execute(
            f"SELECT {COLUMNS} FROM reflections WHERE user_id=? ORDER BY day DESC LIMIT 14", (user["id"],))]


@router.put("/today")
def save_today(data: ReflectionInput, user: User):
    # 1日1件とし、同じ日に答え直した場合は上書きする。
    with database() as db:
        return dict(db.execute(
            f"INSERT INTO reflections VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET "
            "achievement=excluded.achievement,satisfaction=excluded.satisfaction,tiredness=excluded.tiredness,"
            f"comment=excluded.comment,updated_at=excluded.updated_at RETURNING {COLUMNS}",
            (user["id"], today(), data.achievement, data.satisfaction, data.tiredness, data.comment,
             datetime.now(timezone.utc).isoformat()),
        ).fetchone())


@router.get("/summary")
def reflection_summary(user: User):
    end = today()
    start = (date.fromisoformat(end) - timedelta(days=6)).isoformat()
    with database() as db:
        rows = db.execute(
            "SELECT achievement,satisfaction FROM reflections WHERE user_id=? AND day>=? AND day<=?",
            (user["id"], start, end),
        ).fetchall()
    achievement = {"done": 0, "partial": 0, "not_done": 0}
    for row in rows:
        achievement[row["achievement"]] += 1
    return {
        "from": start, "to": end, "answered_days": len(rows), "achievement": achievement,
        "average_satisfaction": round(sum(row["satisfaction"] for row in rows) / len(rows), 1) if rows else None,
    }


@router.get("/plan")
def get_plan(user: User):
    # 今日の作業終了予定。振り返りの通知時刻を決めるために使う。
    with database() as db:
        row = db.execute("SELECT day,end_time FROM work_plans WHERE user_id=? AND day=?", (user["id"], today())).fetchone()
    return dict(row) if row else None


@router.put("/plan")
def save_plan(data: WorkPlanInput, user: User):
    with database() as db:
        return dict(db.execute(
            "INSERT INTO work_plans VALUES (?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET "
            "end_time=excluded.end_time,updated_at=excluded.updated_at RETURNING day,end_time",
            (user["id"], today(), data.end_time, datetime.now(timezone.utc).isoformat()),
        ).fetchone())
