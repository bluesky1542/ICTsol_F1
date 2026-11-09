import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import database
from app.main import app
from helpers import current_user_id


class ActivityCases:
    """取り組みモード（開始・延長・終了）のテスト。SQLite と PostgreSQL の両方で使う。"""

    def activity_task(self, **changes):
        response = self.client.post("/api/tasks", json={"title": "取り組みの確認", "minutes": 25, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def activity_start(self, task_id, **changes):
        self.assertEqual(self.client.put("/api/condition", json={"level": "tired"}).status_code, 200)
        response = self.client.post("/api/activities", json={"task_id": task_id, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def activity_action(self, activity, action, **changes):
        return self.client.patch(f'/api/activities/{activity["id"]}', json={"action": action, **changes})

    def activity_tasks(self):
        return {task["id"]: task for task in self.client.get("/api/tasks").json()}

    def test_activity_start_and_current(self):
        task = self.activity_task()
        started = self.activity_start(task["id"], rank=2)
        self.assertEqual((started["kind"], started["rank"], started["planned_minutes"], started["outcome"]), ("task", 2, 25, None))
        duration = datetime.fromisoformat(started["ends_at"]) - datetime.fromisoformat(started["created_at"])
        self.assertEqual(duration, timedelta(minutes=25))
        self.assertEqual(self.client.get("/api/activities/current").json()["id"], started["id"])

    def test_activity_rest_uses_given_minutes(self):
        rest = self.activity_start(None, minutes=10)
        self.assertEqual((rest["kind"], rest["task_title"], rest["planned_minutes"]), ("rest", None, 10))
        finished = self.activity_action(rest, "finish")
        self.assertEqual(finished.status_code, 200, finished.text)
        self.assertEqual(finished.json()["outcome"], "done")
        self.assertIsNone(self.client.get("/api/activities/current").json())

    def test_activity_extend(self):
        started = self.activity_start(self.activity_task()["id"])
        response = self.activity_action(started, "extend", minutes=10)
        self.assertEqual(response.status_code, 200, response.text)
        extended = response.json()
        self.assertEqual(extended["planned_minutes"], 35)
        self.assertGreater(datetime.fromisoformat(extended["ends_at"]), datetime.fromisoformat(started["ends_at"]))
        self.assertIsNone(extended["outcome"])

    def test_activity_finish_completes_task(self):
        task = self.activity_task()
        started = self.activity_start(task["id"])
        response = self.activity_action(started, "finish")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outcome"], "done")
        self.assertTrue(self.activity_tasks()[task["id"]]["completed"])

    def test_activity_partial_and_stop_keep_task_open(self):
        for action, outcome in [("partial", "partial"), ("stop", "stopped")]:
            with self.subTest(action=action):
                task = self.activity_task()
                response = self.activity_action(self.activity_start(task["id"]), action)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["outcome"], outcome)
                self.assertIsNotNone(response.json()["ended_at"])
                self.assertFalse(self.activity_tasks()[task["id"]]["completed"])

    def test_activity_second_start_stops_previous(self):
        first = self.activity_start(self.activity_task()["id"])
        second = self.activity_start(self.activity_task()["id"])
        history = {entry["id"]: entry for entry in self.client.get("/api/activities").json()}
        self.assertEqual(history[first["id"]]["outcome"], "stopped")
        self.assertIsNone(history[second["id"]]["outcome"])
        self.assertEqual(self.client.get("/api/activities/current").json()["id"], second["id"])

    def test_activity_finished_is_409_and_other_users_404(self):
        started = self.activity_start(self.activity_task()["id"])
        self.assertEqual(self.activity_action(started, "stop").status_code, 200)
        self.assertEqual(self.activity_action(started, "finish").status_code, 409)
        other = self.activity_start(self.activity_task()["id"])
        session = self.client.post("/api/auth/register", json={
            "username": "act_" + os.urandom(8).hex(), "password": "test-password-123",
        }).json()
        response = self.client.patch(f'/api/activities/{other["id"]}', json={"action": "finish"},
                                     headers={"Authorization": "Bearer " + session["token"]})
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(self.client.get("/api/activities/current").json()["outcome"])

    def test_activity_finish_after_task_deleted_only_closes(self):
        task = self.activity_task()
        started = self.activity_start(task["id"])
        self.assertEqual(self.client.delete(f'/api/tasks/{task["id"]}').status_code, 204)
        response = self.activity_action(started, "finish")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outcome"], "done")

    def test_activity_older_than_a_day_is_stopped(self):
        started = self.activity_start(self.activity_task()["id"])
        old = datetime.now(timezone.utc) - timedelta(hours=25)
        with database() as db:
            db.execute("UPDATE activities SET created_at=?, ends_at=? WHERE id=?",
                       (old.isoformat(), (old + timedelta(minutes=25)).isoformat(), started["id"]))
        self.assertIsNone(self.client.get("/api/activities/current").json())
        self.assertEqual(self.activity_action(started, "finish").status_code, 409)

    def test_activity_legacy_rows_are_listed(self):
        task = self.activity_task()
        self.assertEqual(self.client.put("/api/condition", json={"level": "normal"}).status_code, 200)
        user_id = current_user_id(self.client)
        with database() as db:
            db.execute("INSERT INTO activities (user_id,task_id,task_title,condition_level,created_at) VALUES (?,?,?,?,?)",
                       (user_id, task["id"], "旧形式", "normal", datetime.now(timezone.utc).isoformat()))
            db.execute("INSERT INTO activities (user_id,task_id,task_title,condition_level,created_at) VALUES (?,?,?,?,?)",
                       (user_id, None, None, "tired", datetime.now(timezone.utc).isoformat()))
        history = self.client.get("/api/activities").json()
        self.assertEqual([entry["kind"] for entry in history[:2]], ["rest", "task"])
        self.assertIsNone(history[0]["outcome"])
        # 旧形式の行は予定終了時刻がないので、取り組み中としては扱わない。
        self.assertIsNone(self.client.get("/api/activities/current").json())


class SQLiteActivityTest(ActivityCases, unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.path = folder + "/activities.sqlite3"
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": self.path, "GEMINI_API_KEY": "",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "activity_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]

    def test_migration_adds_activity_columns(self):
        import sqlite3
        folder = self.enterContext(tempfile.TemporaryDirectory())
        path = folder + "/old.sqlite3"
        with sqlite3.connect(path) as old:
            old.execute("CREATE TABLE activities (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, "
                        "task_id INTEGER, task_title TEXT, condition_level TEXT NOT NULL, created_at TEXT NOT NULL)")
            old.execute("INSERT INTO activities (user_id,task_id,task_title,condition_level,created_at) VALUES (1,NULL,NULL,'normal','2026-11-01T00:00:00+00:00')")
        with patch.dict(os.environ, {"DATABASE_PATH": path}), TestClient(app):
            with sqlite3.connect(path) as db:
                columns = {row[1] for row in db.execute("PRAGMA table_info(activities)")}
                self.assertTrue({"kind", "rank", "planned_minutes", "ends_at", "outcome", "ended_at"} <= columns)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM activities").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
