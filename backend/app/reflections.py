from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from .auth import User
from .database import database
from .models import ReflectionInput

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
