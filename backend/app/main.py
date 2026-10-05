import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from . import database as storage
from . import recommendations
from .auth import User, router as auth_router
from .calendar import router as calendar_router, free_minutes, get_calendar
from .models import ActivityInput, Condition, SuggestionInput, Task, TaskInput, TaskStatus

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.initialize()
    yield


app = FastAPI(title="ICTsol F1 API", version="0.3.0", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(calendar_router)


@app.middleware("http")
async def private_responses(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

# 許可するWeb画面を環境変数で指定する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    try:
        with storage.database() as db:
            db.execute("SELECT 1")
    except storage.DatabaseErrors:
        raise HTTPException(503, "保存先に接続できません。時間をおいて再試行してください。") from None
    return {"status": "ok", "message": "バックエンドは正常に動作しています"}


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "スマホアプリからの接続に成功しました"}


@app.get("/api/config")
def config(user: User):
    return {"ai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip() and os.getenv("OPENAI_MODEL", "").strip())}


@app.get("/api/tasks", response_model=list[Task])
def list_tasks(user: User):
    return storage.tasks(user["id"])


@app.post("/api/tasks", response_model=Task, status_code=201)
def create_task(task: TaskInput, user: User):
    data = {**task.model_dump(mode="json"), "user_id": user["id"]}
    with storage.database() as db:
        return dict(db.execute(
            "INSERT INTO tasks (title,minutes,deadline,priority,concentration,place,user_id) VALUES (:title,:minutes,:deadline,:priority,:concentration,:place,:user_id) RETURNING *", data,
        ).fetchone())


@app.put("/api/tasks/{task_id}", response_model=Task)
def edit_task(task_id: int, task: TaskInput, user: User):
    with storage.database() as db:
        result = db.execute(
            "UPDATE tasks SET title=:title,minutes=:minutes,deadline=:deadline,priority=:priority,concentration=:concentration,place=:place WHERE id=:id AND user_id=:user_id",
            {**task.model_dump(mode="json"), "id": task_id, "user_id": user["id"]},
        )
        if not result.rowcount:
            raise HTTPException(404, "タスクが見つかりません")
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.patch("/api/tasks/{task_id}", response_model=Task)
def update_status(task_id: int, status: TaskStatus, user: User):
    with storage.database() as db:
        if not db.execute("UPDATE tasks SET completed=? WHERE id=? AND user_id=?", (int(status.completed), task_id, user["id"])).rowcount:
            raise HTTPException(404, "タスクが見つかりません")
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.get("/api/condition")
def get_condition(user: User):
    with storage.database() as db:
        row = db.execute("SELECT level, updated_at FROM user_conditions WHERE user_id=?", (user["id"],)).fetchone()
        if not row:
            return None
        result = dict(row)
        updated = datetime.fromisoformat(result["updated_at"])
        japan = timezone(timedelta(hours=9))
        expires = (updated.astimezone(japan) + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        result["expires_at"] = expires.astimezone(timezone.utc).isoformat()
        return result


def require_current_condition(user):
    condition = get_condition(user)
    if condition is None or datetime.now(timezone.utc) >= datetime.fromisoformat(condition["expires_at"]):
        raise HTTPException(409, "今日の調子を選び直してください。")
    return condition


@app.put("/api/condition")
def save_condition(condition: Condition, user: User):
    updated_at = datetime.now(timezone.utc).isoformat()
    with storage.database() as db:
        db.execute("INSERT INTO user_conditions VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET level=excluded.level, updated_at=excluded.updated_at", (user["id"], condition.level, updated_at))
    return get_condition(user)


@app.post("/api/recommendations")
def suggest(context: SuggestionInput, user: User):
    condition = require_current_condition(user)
    calendar_before = get_calendar(user) if context.use_calendar else None
    available = free_minutes(user, context.available_minutes) if context.use_calendar else context.available_minutes
    candidates = [t for t in storage.tasks(user["id"]) if not t["completed"]
                  and t["minutes"] <= available
                  and (not t["place"] or t["place"] == context.place)]
    # 入力が肥大化しないよう、締切と優先度順で最大30件を送信する。
    candidates.sort(key=lambda t: (t["deadline"] or "9999-12-31", {"high": 0, "medium": 1, "low": 2}[t["priority"]]))
    candidates = candidates[:30]
    if not candidates:
        return {"source": "no_candidates", "available_minutes": available, "choices": [], "rest_reason": "今の時間・場所で取り組めるタスクはありません。休息も選べます。"}
    result = recommendations.generate(candidates, condition["level"], available, context.place, user["id"])
    require_current_condition(user)
    # AI処理中に完了・編集されたタスクの古い提案は表示しない。
    current = {t["id"]: t for t in storage.tasks(user["id"])}
    original = {t["id"]: t for t in candidates}
    calendar_changed = context.use_calendar and (
        get_calendar(user) != calendar_before or
        any(original[c.task_id]["minutes"] > free_minutes(user, context.available_minutes) for c in result.choices)
    )
    if calendar_changed or get_condition(user) != condition or any(current.get(c.task_id) != original[c.task_id] for c in result.choices):
        raise HTTPException(409, "入力が更新されました。もう一度提案を取得してください。")
    return {"source": "ai", "available_minutes": available, "choices": [{"task": Task(**current[c.task_id]), "reason": c.reason} for c in result.choices], "rest_reason": result.rest_reason}


@app.get("/api/activities")
def list_activities(user: User):
    with storage.database() as db:
        return [dict(row) for row in db.execute(
            "SELECT id,task_id,task_title,condition_level,created_at FROM activities WHERE user_id=? ORDER BY id DESC LIMIT 50",
            (user["id"],),
        )]


@app.post("/api/activities", status_code=201)
def save_activity(data: ActivityInput, user: User):
    require_current_condition(user)
    with storage.database() as db:
        condition = db.execute("SELECT level FROM user_conditions WHERE user_id=?", (user["id"],)).fetchone()
        if not condition:
            raise HTTPException(409, "先に今の調子を保存してください。")
        title = None
        if data.task_id is not None:
            task = db.execute("SELECT title,completed FROM tasks WHERE id=? AND user_id=?", (data.task_id, user["id"])).fetchone()
            if not task:
                raise HTTPException(404, "タスクが見つかりません")
            if task["completed"]:
                raise HTTPException(409, "完了済みのタスクです。最新の状態に更新してください。")
            title = task["title"]
        # 選択時のタスク名と調子を残し、後日の編集で履歴が変わらないようにする。
        return dict(db.execute(
            "INSERT INTO activities (user_id,task_id,task_title,condition_level,created_at) VALUES (?,?,?,?,?) RETURNING id,task_id,task_title,condition_level,created_at",
            (user["id"], data.task_id, title, condition["level"], datetime.now(timezone.utc).isoformat()),
        ).fetchone())


# 公開用に書き出した画面を、APIと同じURLで配信する。
web_dist = os.getenv("WEB_DIST_PATH", "").strip()
if web_dist:
    app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")
