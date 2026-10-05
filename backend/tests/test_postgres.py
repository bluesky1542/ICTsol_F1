import os
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import throttle, token_hash
from app.database import database
from app.main import app


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "PostgreSQLのテスト用DBは未設定")
class PostgresTest(unittest.TestCase):
    def setUp(self):
        url = os.environ["TEST_DATABASE_URL"]
        if urlsplit(url).path != "/ictsol_test":
            raise RuntimeError("誤接続防止のため、テストDB名はictsol_testにしてください。")
        self.env = patch.dict(os.environ, {"DATABASE_URL": url, "OPENAI_API_KEY": "", "OPENAI_MODEL": ""})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = self.enterContext(TestClient(app))
        self.username = "pg_" + uuid.uuid4().hex[:16]
        self.credentials = {"username": self.username, "password": "postgres-test-password"}
        response = self.client.post("/api/auth/register", json=self.credentials)
        self.assertEqual(response.status_code, 201, response.text)
        self.token = response.json()["token"]
        self.client.headers["Authorization"] = "Bearer " + self.token

    def test_auth_tasks_history_and_restart(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.post("/api/auth/register", json=self.credentials).status_code, 409)
        self.assertEqual(self.client.post("/api/auth/login", json=self.credentials).status_code, 200)
        response = self.client.post("/api/tasks", json={"title": "PostgreSQL保存", "minutes": 20})
        self.assertEqual(response.status_code, 201, response.text)
        task = response.json()
        self.assertEqual(self.client.put("/api/condition", json={"level": "slightly_tired"}).status_code, 200)
        self.assertEqual(self.client.post("/api/activities", json={"task_id": task["id"]}).status_code, 201)
        self.assertEqual(self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": True}).status_code, 200)
        self.assertTrue(self.client.get("/api/tasks").json()[0]["completed"])
        with TestClient(app) as restarted:
            restarted.headers.update(self.client.headers)
            self.assertEqual(restarted.get("/api/activities").json()[0]["task_title"], "PostgreSQL保存")
        with database() as db:
            db.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", (time.time() + 30, token_hash(self.token)))
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 200)
        self.assertEqual(self.client.get("/api/tasks").status_code, 401)

    def test_user_isolation_and_calendar(self):
        now = datetime.now(timezone.utc)
        data = {"window_start": now.isoformat(), "window_end": (now + timedelta(days=7)).isoformat(), "events": [
            {"key": "test", "starts_at": (now + timedelta(hours=1)).isoformat(), "ends_at": (now + timedelta(hours=2)).isoformat()},
        ]}
        self.assertEqual(self.client.put("/api/calendar", json=data).status_code, 200)
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 1)
        self.assertEqual(self.client.put("/api/calendar", json={**data, "events": []}).status_code, 200)
        self.assertEqual(self.client.get("/api/calendar").json()["events"], [])
        task = self.client.post("/api/tasks", json={"title": "所有者限定", "minutes": 20}).json()
        self.client.put("/api/condition", json={"level": "normal"})
        self.client.post("/api/activities", json={"task_id": task["id"]})
        other = self.client.post("/api/auth/register", json={**self.credentials, "username": self.username + "b"}).json()
        self.client.headers["Authorization"] = "Bearer " + other["token"]
        for path in ["/api/tasks", "/api/activities"]:
            self.assertEqual(self.client.get(path).json(), [])
        self.assertIsNone(self.client.get("/api/condition").json())
        self.assertIsNone(self.client.get("/api/calendar").json()["sync"])
        self.assertEqual(self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": True}).status_code, 404)

    def test_failed_transaction_rolls_back(self):
        with self.assertRaises(RuntimeError):
            with database() as db:
                db.execute("INSERT INTO user_conditions VALUES (?,?,?)", (999999, "normal", "test"))
                raise RuntimeError("ロールバックの確認")
        with database() as db:
            self.assertIsNone(db.execute("SELECT * FROM user_conditions WHERE user_id=?", (999999,)).fetchone())

    def test_parallel_login_limits_are_atomic(self):
        request = SimpleNamespace(client=SimpleNamespace(host=self.username))
        def attempt(_):
            try:
                throttle(request, self.username + "limit")
                return 200
            except HTTPException as error:
                return error.status_code
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(attempt, range(11)))
        self.assertEqual(results.count(200), 10)
        self.assertEqual(results.count(429), 1)
