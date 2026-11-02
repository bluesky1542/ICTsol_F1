from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response

from .auth import User
from .database import database, lock_tasks
from .models import TaskGroup, TaskGroupInput

router = APIRouter(prefix="/api/groups")


def require_group(db, user_id, group_id):
    if not db.execute("SELECT id FROM task_groups WHERE id=? AND user_id=?", (group_id, user_id)).fetchone():
        raise HTTPException(404, "グループが見つかりません")


def unique_name(db, user_id, name, group_id=None):
    row = db.execute("SELECT id FROM task_groups WHERE user_id=? AND name=?", (user_id, name)).fetchone()
    if row and row["id"] != group_id:
        raise HTTPException(409, "同じ名前のグループがあります")


@router.get("", response_model=list[TaskGroup])
def list_groups(user: User):
    with database() as db:
        return [dict(row) for row in db.execute(
            "SELECT id,name FROM task_groups WHERE user_id=? ORDER BY id", (user["id"],))]


@router.post("", response_model=TaskGroup, status_code=201)
def create_group(data: TaskGroupInput, user: User):
    with database() as db:
        lock_tasks(db, user["id"])
        unique_name(db, user["id"], data.name)
        if db.execute("SELECT COUNT(*) AS count FROM task_groups WHERE user_id=?", (user["id"],)).fetchone()["count"] >= 30:
            raise HTTPException(400, "グループは30個まで作成できます")
        return dict(db.execute(
            "INSERT INTO task_groups (user_id,name,created_at) VALUES (?,?,?) RETURNING id,name",
            (user["id"], data.name, datetime.now(timezone.utc).isoformat()),
        ).fetchone())


@router.put("/{group_id}", response_model=TaskGroup)
def rename_group(group_id: int, data: TaskGroupInput, user: User):
    with database() as db:
        lock_tasks(db, user["id"])
        require_group(db, user["id"], group_id)
        unique_name(db, user["id"], data.name, group_id)
        return dict(db.execute("UPDATE task_groups SET name=? WHERE id=? AND user_id=? RETURNING id,name",
                               (data.name, group_id, user["id"])).fetchone())


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: int, user: User):
    with database() as db:
        lock_tasks(db, user["id"])
        require_group(db, user["id"], group_id)
        db.execute("UPDATE tasks SET group_id=NULL WHERE user_id=? AND group_id=?", (user["id"], group_id))
        db.execute("DELETE FROM task_groups WHERE id=? AND user_id=?", (group_id, user["id"]))
    return Response(status_code=204)
