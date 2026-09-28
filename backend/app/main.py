import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from . import database as storage
from . import recommendations
from .models import Condition, SuggestionInput, Task, TaskInput, TaskStatus

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage.initialize()
    yield


app = FastAPI(title="ICTsol F1 API", version="0.2.0", lifespan=lifespan)

# 開発用Web画面からの接続を許可する。認証導入時は許可元を限定する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "バックエンドは正常に動作しています"}


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "スマホアプリからの接続に成功しました"}


@app.get("/api/config")
def config():
    return {"ai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip() and os.getenv("OPENAI_MODEL", "").strip())}


@app.get("/api/tasks", response_model=list[Task])
def list_tasks():
    return storage.tasks()


@app.post("/api/tasks", response_model=Task, status_code=201)
def create_task(task: TaskInput):
    data = task.model_dump(mode="json")
    with storage.database() as db:
        cursor = db.execute(
            "INSERT INTO tasks (title,minutes,deadline,priority,concentration,place) VALUES (:title,:minutes,:deadline,:priority,:concentration,:place)", data,
        )
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (cursor.lastrowid,)).fetchone())


@app.put("/api/tasks/{task_id}", response_model=Task)
def edit_task(task_id: int, task: TaskInput):
    with storage.database() as db:
        result = db.execute(
            "UPDATE tasks SET title=:title,minutes=:minutes,deadline=:deadline,priority=:priority,concentration=:concentration,place=:place WHERE id=:id",
            {**task.model_dump(mode="json"), "id": task_id},
        )
        if not result.rowcount:
            raise HTTPException(404, "タスクが見つかりません")
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.patch("/api/tasks/{task_id}", response_model=Task)
def update_status(task_id: int, status: TaskStatus):
    with storage.database() as db:
        if not db.execute("UPDATE tasks SET completed=? WHERE id=?", (status.completed, task_id)).rowcount:
            raise HTTPException(404, "タスクが見つかりません")
        return dict(db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


@app.get("/api/condition")
def get_condition():
    with storage.database() as db:
        row = db.execute("SELECT level, updated_at FROM conditions WHERE id=1").fetchone()
        return dict(row) if row else None


@app.put("/api/condition")
def save_condition(condition: Condition):
    updated_at = datetime.now(timezone.utc).isoformat()
    with storage.database() as db:
        db.execute("INSERT INTO conditions VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET level=excluded.level, updated_at=excluded.updated_at", (condition.level, updated_at))
    return {"level": condition.level, "updated_at": updated_at}


@app.post("/api/recommendations")
def suggest(context: SuggestionInput):
    condition = get_condition()
    if condition is None:
        raise HTTPException(409, "先に今の調子を保存してください。")
    candidates = [t for t in storage.tasks() if not t["completed"]
                  and t["minutes"] <= context.available_minutes
                  and (not t["place"] or t["place"] == context.place)]
    # 入力が肥大化しないよう、締切と優先度順で最大30件を送信する。
    candidates.sort(key=lambda t: (t["deadline"] or "9999-12-31", {"high": 0, "medium": 1, "low": 2}[t["priority"]]))
    candidates = candidates[:30]
    if not candidates:
        return {"source": "no_candidates", "choices": [], "rest_reason": "今の時間・場所で取り組めるタスクはありません。休息も選べます。"}
    result = recommendations.generate(candidates, condition["level"], context.available_minutes, context.place)
    # AI処理中に完了・編集されたタスクの古い提案は表示しない。
    current = {t["id"]: t for t in storage.tasks()}
    original = {t["id"]: t for t in candidates}
    if get_condition() != condition or any(current.get(c.task_id) != original[c.task_id] for c in result.choices):
        raise HTTPException(409, "入力が更新されました。もう一度提案を取得してください。")
    return {"source": "ai", "choices": [{"task": Task(**current[c.task_id]), "reason": c.reason} for c in result.choices], "rest_reason": result.rest_reason}
