import os
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.database import database, initialize
from app.calendar import free_minutes
from app.auth import token_hash


class AccountsCalendarTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"DATABASE_PATH": self.temp.name + "/test.sqlite3"})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()
        self.a = self.register("alice")
        self.b = self.register("bob")
        self.client.headers["Authorization"] = "Bearer " + self.a["token"]

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def register(self, name):
        result = self.client.post("/api/auth/register", json={"username": name, "password": "test-password-123"})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def data(self, events=None):
        now = datetime.now(timezone.utc)
        return {"window_start": (now - timedelta(minutes=1)).isoformat(), "window_end": (now + timedelta(days=7)).isoformat(), "events": events or []}

    def test_auth_login_logout_expiry_hashes(self):
        self.assertEqual(self.client.get("/api/auth/me").json()["username"], "alice")
        with database() as db:
            hashed = db.execute("SELECT password_hash FROM users WHERE username='alice'").fetchone()[0]
            self.assertNotEqual(hashed, "test-password-123")
            self.assertNotIn(self.a["token"], str(db.execute("SELECT * FROM sessions").fetchall()))
        wrong = self.client.post("/api/auth/login", json={"username": "alice", "password": "wrong-password-123"})
        self.assertEqual(wrong.status_code, 401)
        login = self.client.post("/api/auth/login", json={"username": "ALICE", "password": "test-password-123"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.headers["cache-control"], "no-store")
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/tasks").status_code, 401)
        self.client.headers["Authorization"] = "Bearer " + login.json()["token"]
        with database() as db:
            db.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", (time.time() - 1, token_hash(login.json()["token"])))
        self.assertEqual(self.client.get("/api/tasks").status_code, 401)

    def test_anonymous_protected_and_rate_limit(self):
        self.client.headers.pop("Authorization")
        for path in ["/api/tasks", "/api/condition", "/api/calendar", "/api/config", "/api/auth/me"]:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 401)
        for _ in range(11):
            result = self.client.post("/api/auth/login", json={"username": "unknown", "password": "wrong-password-123"})
        self.assertEqual(result.status_code, 429)

    def test_task_condition_isolation(self):
        task = self.client.post("/api/tasks", json={"title": "自分のタスク", "minutes": 20}).json()
        self.assertNotIn("user_id", task)
        self.client.put("/api/condition", json={"level": "good"})
        self.client.headers["Authorization"] = "Bearer " + self.b["token"]
        self.assertEqual(self.client.get("/api/tasks").json(), [])
        self.assertIsNone(self.client.get("/api/condition").json())
        self.assertEqual(self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": True}).status_code, 404)
        self.assertEqual(self.client.put(f'/api/tasks/{task["id"]}', json={"title": "他人の変更", "minutes": 10}).status_code, 404)
        self.client.put("/api/condition", json={"level": "tired"})
        with patch("app.recommendations.generate") as ai:
            result = self.client.post("/api/recommendations", json={"available_minutes": 30})
            self.assertEqual(result.json()["source"], "no_candidates")
            ai.assert_not_called()
        self.client.headers["Authorization"] = "Bearer " + self.a["token"]
        self.assertEqual(self.client.get("/api/tasks").json()[0]["title"], "自分のタスク")
        self.assertEqual(self.client.get("/api/condition").json()["level"], "good")

    def test_calendar_replace_isolation_disconnect_validation(self):
        now = datetime.now(timezone.utc)
        event = {"key": "event", "starts_at": now.isoformat(), "ends_at": (now + timedelta(hours=1)).isoformat()}
        data = self.data([event])
        self.assertEqual(self.client.put("/api/calendar", json=data).status_code, 200)
        self.assertEqual(self.client.put("/api/calendar", json=data).status_code, 200)
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 1)
        self.client.headers["Authorization"] = "Bearer " + self.b["token"]
        self.assertIsNone(self.client.get("/api/calendar").json()["sync"])
        self.client.delete("/api/calendar")
        self.client.headers["Authorization"] = "Bearer " + self.a["token"]
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 1)
        for bad in [[event, event], [{**event, "ends_at": event["starts_at"]}], [{**event, "starts_at": "2026-10-05T14:00:00"}]]:
            self.assertEqual(self.client.put("/api/calendar", json=self.data(bad)).status_code, 422)
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 1)
        self.client.delete("/api/calendar")
        self.assertEqual(self.client.get("/api/calendar").json(), {"sync": None, "events": []})

    def test_free_time_and_busy_ai_skipped(self):
        now = datetime.now(timezone.utc)
        event = {"key": "busy", "starts_at": (now + timedelta(minutes=20)).isoformat(), "ends_at": (now + timedelta(minutes=60)).isoformat()}
        self.client.put("/api/calendar", json=self.data([event]))
        self.assertEqual(free_minutes(self.a["user"], 90, now), 20)
        self.assertEqual(free_minutes(self.a["user"], 90, now + timedelta(minutes=30)), 0)
        self.assertEqual(free_minutes(self.a["user"], 90, now + timedelta(minutes=60)), 90)
        self.client.put("/api/condition", json={"level": "good"})
        self.client.post("/api/tasks", json={"title": "長いタスク", "minutes": 30})
        with patch("app.recommendations.generate") as ai:
            response = self.client.post("/api/recommendations", json={"available_minutes": 90, "use_calendar": True})
            self.assertEqual(response.json()["source"], "no_candidates")
            ai.assert_not_called()
        with database() as db:
            db.execute("UPDATE calendar_sync SET synced_at=?", ((now - timedelta(days=2)).isoformat(),))
        self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30, "use_calendar": True}).status_code, 409)

    def test_legacy_data_stays_private_and_migration_idempotent(self):
        with database() as db:
            db.execute("INSERT INTO tasks (title,minutes,priority,concentration,place) VALUES ('匿名の記録',10,'low','low','')")
            db.execute("INSERT INTO conditions VALUES (1,'normal','2026-10-01')")
        initialize()
        initialize()
        self.assertEqual(self.client.get("/api/tasks").json(), [])
        self.assertIsNone(self.client.get("/api/condition").json())
        with database() as db:
            self.assertEqual(db.execute("SELECT title FROM tasks WHERE user_id IS NULL").fetchone()[0], "匿名の記録")

    def test_original_schema_migrates_without_loss(self):
        path = self.temp.name + "/old.sqlite3"
        with closing(sqlite3.connect(path)) as db:
            db.executescript("""
                CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, minutes INTEGER NOT NULL,
                    deadline TEXT, priority TEXT NOT NULL, concentration TEXT NOT NULL, place TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE conditions (id INTEGER PRIMARY KEY CHECK(id=1), level TEXT NOT NULL, updated_at TEXT NOT NULL);
                INSERT INTO tasks VALUES (1,'旧版タスク',20,NULL,'medium','medium','',0);
                INSERT INTO conditions VALUES (1,'good','2026-09-28');
            """)
        with patch.dict(os.environ, {"DATABASE_PATH": path}):
            initialize()
            initialize()
            with database() as db:
                self.assertEqual(db.execute("SELECT title,user_id FROM tasks").fetchone()[:], ("旧版タスク", None))
                self.assertEqual(db.execute("SELECT level FROM conditions").fetchone()[0], "good")

    def test_cors_and_response_cache(self):
        headers = {"Origin": "http://localhost:8081", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"}
        self.assertEqual(self.client.options("/api/tasks", headers=headers).status_code, 200)
        self.assertEqual(self.client.options("/api/tasks", headers={**headers, "Origin": "https://untrusted.example"}).status_code, 400)
        self.assertEqual(self.client.get("/api/tasks").headers["cache-control"], "no-store")


if __name__ == "__main__":
    unittest.main()
