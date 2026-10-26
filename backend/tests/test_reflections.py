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

    def test_work_plan_saved_per_day_and_user(self):
        self.assertIsNone(self.client.get("/api/reflections/plan").json())
        saved = self.client.put("/api/reflections/plan", json={"end_time": "18:30"})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json(), {"day": today(), "end_time": "18:30"})
        self.client.put("/api/reflections/plan", json={"end_time": "20:00"})
        self.assertEqual(self.client.get("/api/reflections/plan").json()["end_time"], "20:00")
        # 前日の予定は今日には引き継がない。
        with database() as db:
            db.execute("UPDATE work_plans SET day='2000-01-01'")
        self.assertIsNone(self.client.get("/api/reflections/plan").json())
        self.client.put("/api/reflections/plan", json={"end_time": "17:00"})
        self.login("plan_other")
        self.assertIsNone(self.client.get("/api/reflections/plan").json())
        for bad in ["24:00", "9:00", "18:60", "", "18:00:00"]:
            self.assertEqual(self.client.put("/api/reflections/plan", json={"end_time": bad}).status_code, 422, bad)
        self.assertEqual(self.client.put("/api/reflections/plan", json={"end_time": "18:00", "user_id": 1}).status_code, 422)
        del self.client.headers["Authorization"]
        self.assertEqual(self.client.get("/api/reflections/plan").status_code, 401)

    def test_empty_summary(self):
        with patch("app.reflections.today", return_value="2026-10-19"):
            response = self.client.get("/api/reflections/summary")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {
            "from": "2026-10-13", "to": "2026-10-19", "answered_days": 0,
            "achievement": {"done": 0, "partial": 0, "not_done": 0}, "average_satisfaction": None,
        })

    def test_summary_includes_only_seven_calendar_days_and_latest_answers(self):
        for day, achievement, satisfaction in [
            ("2026-10-12", "not_done", 1), ("2026-10-13", "done", 5),
            ("2026-10-17", "partial", 3), ("2026-10-19", "not_done", 2), ("2026-10-20", "done", 5),
        ]:
            with patch("app.reflections.today", return_value=day):
                self.client.put("/api/reflections/today", json={
                    **self.answer, "achievement": achievement, "satisfaction": satisfaction,
                })
        with patch("app.reflections.today", return_value="2026-10-19"):
            summary = self.client.get("/api/reflections/summary").json()
            self.assertEqual(summary["answered_days"], 3)
            self.assertEqual(summary["achievement"], {"done": 1, "partial": 1, "not_done": 1})
            self.assertEqual(summary["average_satisfaction"], 3.3)
            self.client.put("/api/reflections/today", json={**self.answer, "achievement": "done", "satisfaction": 4})
            updated = self.client.get("/api/reflections/summary").json()
            self.assertEqual(updated["answered_days"], 3)
            self.assertEqual(updated["achievement"], {"done": 2, "partial": 1, "not_done": 0})
            self.assertEqual(updated["average_satisfaction"], 4.0)

    def test_summary_changes_at_japan_midnight(self):
        with patch("app.reflections.today", return_value="2026-10-13"):
            self.client.put("/api/reflections/today", json=self.answer)
        for instant, start, end, count in [
            (datetime(2026, 10, 19, 14, 59, tzinfo=timezone.utc), "2026-10-13", "2026-10-19", 1),
            (datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc), "2026-10-14", "2026-10-20", 0),
        ]:
            with self.subTest(instant=instant), patch("app.reflections.datetime") as clock:
                clock.now.return_value = instant
                summary = self.client.get("/api/reflections/summary").json()
                self.assertEqual((summary["from"], summary["to"], summary["answered_days"]), (start, end, count))

    def test_summary_is_private_and_requires_login(self):
        self.client.put("/api/reflections/today", json=self.answer)
        self.login("summary_other_user")
        self.assertEqual(self.client.get("/api/reflections/summary").json()["answered_days"], 0)
        del self.client.headers["Authorization"]
        self.assertEqual(self.client.get("/api/reflections/summary").status_code, 401)
