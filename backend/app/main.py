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
from .reflections import router as reflections_router
from .groups import router as groups_router, list_groups
from .models import ActivityInput, Condition, SuggestionInput, Task, TaskInput, TaskStatus

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.initialize()
    yield


app = FastAPI(title="ICTsol F1 API", version="0.3.0", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(calendar_router)
app.include_router(reflections_router)
app.include_router(groups_router)


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
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    return {"ai_configured": bool(key and model)}


@app.get("/api/tasks", response_model=list[Task])
def list_tasks(user: User):
    return storage.tasks(user["id"])


@app.post("/api/tasks", response_model=Task, status_code=201)
def create_task(task: TaskInput, user: User):
    data = {**task.model_dump(mode="json"), "user_id": user["id"]}
    with storage.database() as db:
        storage.lock_tasks(db, user["id"])
        validate_parent(db, user["id"], task.parent_id)
        data["group_id"] = task_group(db, user["id"], task)
        saved = dict(db.execute(
            "INSERT INTO tasks (title,minutes,deadline,priority,concentration,place,parent_id,group_id,user_id) VALUES (:title,:minutes,:deadline,:priority,:concentration,:place,:parent_id,:group_id,:user_id) RETURNING *", data,
        ).fetchone())
        storage.refresh_ancestors(db, user["id"], task.parent_id)
        return saved


def task_group(db, user_id, task):
    if task.parent_id is not None:
        return db.execute("SELECT group_id FROM tasks WHERE id=? AND user_id=?", (task.parent_id, user_id)).fetchone()["group_id"]
    if task.group_id is not None and not db.execute(
        "SELECT id FROM task_groups WHERE id=? AND user_id=?", (task.group_id, user_id),
    ).fetchone():
        raise HTTPException(400, "グループが見つかりません")
    return task.group_id


def sync_group(db, user_id, task_id, group_id):
    # 循環した既存データでも止まり、深いツリーでも再帰上限に触れない。
    children = {}
    for row in db.execute("SELECT id,parent_id FROM tasks WHERE user_id=?", (user_id,)):
        children.setdefault(row["parent_id"], []).append(row["id"])
    pending, visited = [task_id], set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        db.execute("UPDATE tasks SET group_id=? WHERE id=? AND user_id=?", (group_id, current, user_id))
        pending.extend(children.get(current, []))


def validate_parent(db, user_id, parent_id, task_id=None):
    if parent_id is None:
        return
    parents = {row["id"]: row["parent_id"] for row in db.execute(
        "SELECT id,parent_id FROM tasks WHERE user_id=?", (user_id,))}
    if parent_id not in parents:
        raise HTTPException(400, "親タスクが見つかりません")
    visited = set()
    while parent_id is not None and parent_id not in visited:
        if parent_id == task_id:
            raise HTTPException(400, "自分自身やその下のタスクは親にできません")
        visited.add(parent_id)
        parent_id = parents.get(parent_id)


@app.put("/api/tasks/{task_id}", response_model=Task)
def edit_task(task_id: int, task: TaskInput, user: User):
    with storage.database() as db:
        storage.lock_tasks(db, user["id"])
        previous = db.execute("SELECT parent_id FROM tasks WHERE id=? AND user_id=?", (task_id, user["id"])).fetchone()
        if not previous:
            raise HTTPException(404, "タスクが見つかりません")
        validate_parent(db, user["id"], task.parent_id, task_id)
        group_id = task_group(db, user["id"], task)
        db.execute(
            "UPDATE tasks SET title=:title,minutes=:minutes,deadline=:deadline,priority=:priority,concentration=:concentration,place=:place,parent_id=:parent_id WHERE id=:id AND user_id=:user_id",
            {**task.model_dump(mode="json"), "id": task_id, "user_id": user["id"]},
        )
        sync_group(db, user["id"], task_id, group_id)
        if previous["parent_id"] != task.parent_id:
            storage.refresh_ancestors(db, user["id"], previous["parent_id"])
        storage.refresh_ancestors(db, user["id"], task.parent_id)
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.patch("/api/tasks/{task_id}", response_model=Task)
def update_status(task_id: int, status: TaskStatus, user: User):
    with storage.database() as db:
        storage.lock_tasks(db, user["id"])
        task = db.execute("SELECT parent_id FROM tasks WHERE id=? AND user_id=?", (task_id, user["id"])).fetchone()
        if not task:
            raise HTTPException(404, "タスクが見つかりません")
        if db.execute("SELECT 1 FROM tasks WHERE parent_id=? AND user_id=?", (task_id, user["id"])).fetchone():
            raise HTTPException(400, "子タスクがあるタスクは、子をすべて完了すると自動で完了になります")
        if not db.execute("UPDATE tasks SET completed=? WHERE id=? AND user_id=?", (int(status.completed), task_id, user["id"])).rowcount:
            raise HTTPException(404, "タスクが見つかりません")
        storage.refresh_ancestors(db, user["id"], task["parent_id"])
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
        db.execute("INSERT INTO condition_logs (user_id,level,created_at) VALUES (?,?,?)", (user["id"], condition.level, updated_at))
    return get_condition(user)


@app.post("/api/recommendations")
def suggest(context: SuggestionInput, user: User):
    condition = require_current_condition(user)
    calendar_before = get_calendar(user) if context.use_calendar else None
    available = free_minutes(user, context.available_minutes) if context.use_calendar else context.available_minutes
    all_tasks = storage.tasks(user["id"])
    parents = {t["parent_id"] for t in all_tasks}
    candidates = [t for t in all_tasks if not t["completed"] and t["id"] not in parents
                  and t["minutes"] <= available
                  and (not t["place"] or t["place"] == context.place)]
    # 入力が肥大化しないよう、締切と優先度順で最大30件を送信する。
    # 時刻なしの締切はその日の終わり、締切なしは最後として並べる。
    candidates.sort(key=lambda t: (
        (t["deadline"] + "T24:00" if len(t["deadline"]) == 10 else t["deadline"]) if t["deadline"] else "9999-12-31T99:99",
        {"high": 0, "medium": 1, "low": 2}[t["priority"]]))
    candidates = candidates[:30]
    if not candidates:
        return {"source": "no_candidates", "available_minutes": available, "choices": [], "rest_reason": "今の時間・場所で取り組めるタスクはありません。休息も選べます。"}
    titles = {t["id"]: t["title"] for t in all_tasks}
    group_names = {group["id"]: group["name"] for group in list_groups(user)}
    ai_tasks = [{**{key: t[key] for key in (
        "id", "title", "minutes", "deadline", "priority", "concentration", "place", "parent_id")},
        "parent_title": titles.get(t["parent_id"]),
        "group_name": group_names.get(t["group_id"])} for t in candidates]
    result = recommendations.generate(ai_tasks, condition["level"], available, context.place, user["id"])
    require_current_condition(user)
    # AI処理中に完了・編集されたタスクの古い提案は表示しない。
    current = {t["id"]: t for t in storage.tasks(user["id"])}
    current_parents = {t["parent_id"] for t in current.values()}
    original = {t["id"]: t for t in candidates}
    calendar_changed = context.use_calendar and (
        get_calendar(user) != calendar_before or
        any(original[c.task_id]["minutes"] > free_minutes(user, context.available_minutes) for c in result.choices)
    )
    if calendar_changed or get_condition(user) != condition or any(
        c.task_id in current_parents or current.get(c.task_id) != original[c.task_id] for c in result.choices
    ):
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
