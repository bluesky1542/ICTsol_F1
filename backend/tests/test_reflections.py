import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import database
from app.main import app
from app.reflections import today


class ReflectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "DATABASE_URL": "", "REQUIRE_DATABASE_URL": "0", "DATABASE_PATH": self.temp + "/reflection.sqlite3",
        }))
        self.client = self.enterContext(TestClient(app))
        self.login("reflection_user")
        self.answer = {"achievement": "partial", "satisfaction": 4, "tiredness": "slightly_tired", "comment": " 午前は集中できた "}

    def login(self, username):
        result = self.client.post("/api/auth/register", json={"username": username, "password": "local-test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + result["token"]

    def test_save_and_overwrite_same_day(self):
        saved = self.client.put("/api/reflections/today", json=self.answer)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["day"], today())
        self.assertEqual(saved.json()["comment"], "午前は集中できた")
        self.client.put("/api/reflections/today", json={**self.answer, "achievement": "done", "comment": ""})
        rows = self.client.get("/api/reflections").json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["achievement"], "done")

    def test_new_day_adds_row_newest_first(self):
        self.client.put("/api/reflections/today", json=self.answer)
        with database() as db:
            db.execute("UPDATE reflections SET day='2000-01-01'")
        self.client.put("/api/reflections/today", json=self.answer)
        self.assertEqual([r["day"] for r in self.client.get("/api/reflections").json()], [today(), "2000-01-01"])

    def test_japan_date_boundary(self):
        # UTC 15:00は日本時間の翌日0時になる。
        self.assertEqual(today(datetime(2026, 10, 19, 14, 59, tzinfo=timezone.utc)), "2026-10-19")
        self.assertEqual(today(datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc)), "2026-10-20")

    def test_invalid_answers_rejected(self):
        for bad in [{**self.answer, "satisfaction": 6}, {**self.answer, "achievement": "maybe"},
                    {**self.answer, "comment": "あ" * 201}, {k: v for k, v in self.answer.items() if k != "tiredness"},
                    {**self.answer, "user_id": 1}]:
            self.assertEqual(self.client.put("/api/reflections/today", json=bad).status_code, 422)

    def test_requires_login_and_isolated_per_user(self):
        self.client.put("/api/reflections/today", json=self.answer)
        self.login("other_user")
        self.assertEqual(self.client.get("/api/reflections").json(), [])
        del self.client.headers["Authorization"]
        self.assertEqual(self.client.get("/api/reflections").status_code, 401)
        self.assertEqual(self.client.put("/api/reflections/today", json=self.answer).status_code, 401)
