import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.database import database, initialize
from app.main import app
from helpers import current_user_id


class TaskGroupCases:
    def group(self, name="授業"):
        response = self.client.post("/api/groups", json={"name": name})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def group_task(self, **changes):
        response = self.client.post("/api/tasks", json={"title": "確認", "minutes": 10, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def group_edit(self, task, **changes):
        response = self.client.put(f'/api/tasks/{task["id"]}', json={
            "title": task["title"], "minutes": task["minutes"],
            "group_id": task["group_id"], **changes,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_groups(self, expected):
        actual = {task["id"]: task["group_id"] for task in self.client.get("/api/tasks").json()}
        for task, group_id in expected:
            self.assertEqual(actual[task["id"]], group_id)

    def test_groups_crud_and_validation(self):
        first = self.group(" 授業 ")
        second = self.group("バイト")
        self.assertEqual(first["name"], "授業")
        self.assertEqual(self.client.get("/api/groups").json(), [first, second])
        self.assertEqual(self.client.post("/api/groups", json={"name": "授業"}).status_code, 409)
        self.assertEqual(self.client.put(f'/api/groups/{second["id"]}', json={"name": "授業"}).status_code, 409)
        response = self.client.put(f'/api/groups/{first["id"]}', json={"name": "生活"})
        self.assertEqual(response.json(), {**first, "name": "生活"})
        self.assertEqual(self.client.put(f'/api/groups/{first["id"]}', json={"name": "生活"}).status_code, 200)
        for data in ({"name": " "}, {"name": "あ" * 31}, {"name": "授業", "extra": True}):
            self.assertEqual(self.client.post("/api/groups", json=data).status_code, 422)
        self.assertEqual(self.client.delete(f'/api/groups/{second["id"]}').status_code, 204)
        self.assertEqual(len(self.client.get("/api/groups").json()), 1)

    def test_groups_limit_and_concurrent_duplicates(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: self.client.post("/api/groups", json={"name": "同時"}), range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
        for index in range(29):
            self.group(f"グループ{index}")
        self.assertEqual(self.client.post("/api/groups", json={"name": "上限超過"}).status_code, 400)

    def test_groups_private_and_invalid_task_group(self):
        other = self.enterContext(TestClient(app))
        user_id = current_user_id(self.client)
        session = other.post("/api/auth/register", json={
            "username": f"group_other_{user_id}", "password": "test-password-123",
        }).json()
        other.headers["Authorization"] = "Bearer " + session["token"]
        private = other.post("/api/groups", json={"name": "非公開"}).json()
        self.assertEqual(self.client.get("/api/groups").json(), [])
        task = self.group_task()
        for group_id in (private["id"], 2147483647):
            for response in (
                self.client.put(f"/api/groups/{group_id}", json={"name": "変更"}),
                self.client.delete(f"/api/groups/{group_id}"),
            ):
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json()["detail"], "グループが見つかりません")
            for response in (
                self.client.post("/api/tasks", json={"title": "確認", "minutes": 10, "group_id": group_id}),
                self.client.put(f'/api/tasks/{task["id"]}', json={"title": "確認", "minutes": 10, "group_id": group_id}),
            ):
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "グループが見つかりません")
        self.assertEqual(other.get("/api/groups").json(), [private])
        for group_id in (0, -1):
            self.assertEqual(self.client.post("/api/tasks", json={"title": "確認", "minutes": 10, "group_id": group_id}).status_code, 422)

    def test_groups_move_and_delete_keeps_tasks(self):
        first, second = self.group(), self.group("生活")
        task = self.group_task(group_id=first["id"])
        self.assert_groups([(task, first["id"])])
        task = self.group_edit(task, group_id=second["id"])
        self.assert_groups([(task, second["id"])])
        self.assertEqual(self.client.delete(f'/api/groups/{second["id"]}').status_code, 204)
        tasks = self.client.get("/api/tasks").json()
        self.assertEqual([(value["id"], value["group_id"]) for value in tasks], [(task["id"], None)])
        self.assertNotIn("parent_id", tasks[0])

    def test_groups_gemini_payload(self):
        group = self.group()
        grouped = self.group_task(group_id=group["id"])
        plain = self.group_task()
        self.client.put("/api/condition", json={"level": "normal"})
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret"}), patch("app.recommendations.httpx.Client") as http:
            post = http.return_value.__enter__.return_value.post
            post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.com"), json={
                "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({
                    "choices": [], "rest_reason": "休息も選べます",
                })}]}}],
            })
            response = self.client.post("/api/recommendations", json={"available_minutes": 30})
            self.assertEqual(response.status_code, 200, response.text)
            body = post.call_args.kwargs["json"]
            tasks = json.loads(body["contents"][0]["parts"][0]["text"])["tasks"]
            names = {task["id"]: task["group_name"] for task in tasks}
            self.assertEqual(names, {grouped["id"]: "授業", plain["id"]: None})
            self.assertIn("group_name", body["systemInstruction"]["parts"][0]["text"])

    def test_tree_is_migrated_to_groups(self):
        # 親子（ツリー）の時代のデータ：見出し「レポート」の下に子と、さらに中見出しの下に孫。
        user_id = current_user_id(self.client)
        existing = self.group("授業")
        with database() as db:
            add = lambda title, parent, completed=0, group=None: db.execute(
                "INSERT INTO tasks (title,minutes,priority,concentration,place,parent_id,group_id,completed,user_id) "
                "VALUES (?,10,'medium','medium','',?,?,?,?) RETURNING id", (title, parent, group, completed, user_id)).fetchone()["id"]
            report = add("レポート", None, group=existing["id"])
            child = add("下書き", report, completed=1, group=existing["id"])
            middle = add("中見出し", report, group=existing["id"])
            grandchild = add("参考文献", middle, group=existing["id"])
            lesson = add("授業", None)
            homework = add("宿題", lesson)
            alone = add("ひとりのタスク", None)
        initialize()
        initialize()
        tasks = {task["id"]: task for task in self.client.get("/api/tasks").json()}
        groups = {group["name"]: group["id"] for group in self.client.get("/api/groups").json()}
        self.assertEqual(set(tasks), {child, grandchild, homework, alone})
        self.assertEqual(groups.keys(), {"授業", "レポート"})
        self.assertEqual(tasks[child]["group_id"], groups["レポート"])
        self.assertTrue(tasks[child]["completed"])
        self.assertEqual(tasks[grandchild]["group_id"], groups["レポート"])
        # 同じ名前のグループがすでにあれば、それを使う。
        self.assertEqual(tasks[homework]["group_id"], existing["id"])
        self.assertIsNone(tasks[alone]["group_id"])
        with database() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) AS n FROM tasks WHERE parent_id IS NOT NULL").fetchone()["n"], 0)


class SQLiteTaskGroupTest(TaskGroupCases, unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": folder + "/groups.sqlite3", "GEMINI_API_KEY": "",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "groups_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]

    def test_groups_legacy_migration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = folder + "/legacy.sqlite3"
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, minutes INTEGER NOT NULL, "
                           "deadline TEXT, priority TEXT NOT NULL, concentration TEXT NOT NULL, place TEXT NOT NULL, "
                           "completed INTEGER NOT NULL DEFAULT 0, user_id INTEGER, parent_id INTEGER)")
                db.execute("INSERT INTO tasks VALUES (1,'既存',10,NULL,'medium','medium','',1,1,NULL)")
            with patch.dict(os.environ, {"DATABASE_PATH": path}):
                initialize()
                initialize()
                with database() as db:
                    row = db.execute("SELECT * FROM tasks WHERE id=1").fetchone()
                    self.assertIsNone(row["group_id"])
                    self.assertEqual(row["completed"], 1)
                    self.assertIn("tasks_group", {row[1] for row in db.execute("PRAGMA index_list(tasks)")})
                    self.assertIn("task_groups_owner_name", {row[1] for row in db.execute("PRAGMA index_list(task_groups)")})
