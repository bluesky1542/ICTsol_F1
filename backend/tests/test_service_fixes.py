import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.database import database, initialize
from app.main import app
from app.models import AIResult
from app.usage import reserve_ai_call


class ServiceFixesTest(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "DATABASE_URL": "", "REQUIRE_DATABASE_URL": "0", "DATABASE_PATH": self.temp + "/review.sqlite3",
            "OPENAI_API_KEY": "test", "OPENAI_MODEL": "test", "AI_USER_MINUTE_LIMIT": "10",
            "AI_USER_DAILY_LIMIT": "20", "AI_GLOBAL_DAILY_LIMIT": "100", "AI_GLOBAL_MONTHLY_LIMIT": "1000",
        }))
        self.client = self.enterContext(TestClient(app))
        self.credentials = {"username": "review_user", "password": "local-test-password-123"}
        result = self.client.post("/api/auth/register", json=self.credentials).json()
        self.user = result["user"]
        self.client.headers["Authorization"] = "Bearer " + result["token"]
        self.client.put("/api/condition", json={"level": "normal"})
        self.client.post("/api/tasks", json={"title": "確認", "minutes": 10})

    def test_successful_logins_do_not_exhaust_limits(self):
        for _ in range(65):
            self.assertEqual(self.client.post("/api/auth/login", json=self.credentials).status_code, 200)
        wrong = {**self.credentials, "password": "wrong-password-123"}
        for _ in range(10):
            self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 429)

    def test_failed_attempts_survive_success(self):
        wrong = {**self.credentials, "password": "wrong-password-123"}
        for _ in range(9):
            self.client.post("/api/auth/login", json=wrong)
        self.assertEqual(self.client.post("/api/auth/login", json=self.credentials).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json=wrong).status_code, 429)

    def test_ai_limits_stop_before_external_call_and_survive_restart(self):
        with patch.dict(os.environ, {"AI_USER_DAILY_LIMIT": "2"}), patch("app.recommendations.OpenAI") as client:
            parse = client.return_value.__enter__.return_value.responses.parse
            parse.return_value = SimpleNamespace(status="completed", output_parsed=AIResult(choices=[], rest_reason="休息"))
            for _ in range(2):
                self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 200)
            initialize()
            result = self.client.post("/api/recommendations", json={"available_minutes": 30})
            self.assertEqual(result.status_code, 429)
            self.assertIn("retry-after", result.headers)
            self.assertEqual(parse.call_count, 2)

    def test_parallel_users_cannot_exceed_global_limit(self):
        def reserve(user_id):
            try:
                reserve_ai_call(user_id)
                return 200
            except HTTPException as error:
                return error.status_code
        with patch.dict(os.environ, {"AI_GLOBAL_DAILY_LIMIT": "3"}), ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(reserve, range(10)))
        self.assertEqual(results.count(200), 3)
        self.assertEqual(results.count(429), 7)

    def test_month_limit_and_zero_stop(self):
        with patch.dict(os.environ, {"AI_GLOBAL_MONTHLY_LIMIT": "1"}):
            reserve_ai_call(1)
            with self.assertRaises(HTTPException) as caught:
                reserve_ai_call(2)
            self.assertEqual(caught.exception.status_code, 429)
        with database() as db:
            db.execute("DELETE FROM ai_usage")
        with patch.dict(os.environ, {"AI_GLOBAL_DAILY_LIMIT": "0"}):
            with self.assertRaises(HTTPException):
                reserve_ai_call(1)

    def test_quota_period_rollover_and_failures_count(self):
        with patch.dict(os.environ, {"AI_USER_DAILY_LIMIT": "1"}), patch("app.recommendations.OpenAI") as client:
            client.return_value.__enter__.return_value.responses.parse.return_value = SimpleNamespace(status="incomplete", output_parsed=None)
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 502)
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 429)
        with database() as db:
            db.execute("UPDATE ai_usage SET expires_at=0")
        reserve_ai_call(self.user["id"])

    def test_previous_japan_date_is_rejected_until_updated(self):
        with database() as db:
            db.execute("UPDATE user_conditions SET updated_at=?", ((datetime.now(timezone.utc)-timedelta(days=1)).isoformat(),))
        with patch("app.recommendations.generate") as ai:
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 409)
            self.assertEqual(self.client.post("/api/activities", json={"task_id": None}).status_code, 409)
            ai.assert_not_called()
        condition = self.client.put("/api/condition", json={"level": "good"}).json()
        self.assertGreater(datetime.fromisoformat(condition["expires_at"]), datetime.now(timezone.utc))
        self.assertEqual(datetime.fromisoformat(condition["expires_at"]).astimezone(timezone(timedelta(hours=9))).hour, 0)

    def test_manual_calendar_remains_valid_after_24_hours(self):
        now = datetime.now(timezone.utc)
        event = {"starts_at": (now + timedelta(days=2)).isoformat(), "ends_at": (now + timedelta(days=2, hours=1)).isoformat()}
        result = self.client.post("/api/calendar/manual", json=event)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["sync"]["source"], "manual")
        self.client.post("/api/calendar/manual", json=event)
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 1)
        with database() as db:
            db.execute("UPDATE calendar_sync SET synced_at=?", ((now-timedelta(hours=25)).isoformat(),))
        with patch("app.recommendations.generate", return_value=AIResult(choices=[], rest_reason="休息")):
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30, "use_calendar": True}).status_code, 200)

    def test_manual_add_does_not_refresh_imported_calendar(self):
        now = datetime.now(timezone.utc)
        event = {"key": "native-event", "starts_at": (now+timedelta(days=2)).isoformat(), "ends_at": (now+timedelta(days=2, hours=1)).isoformat()}
        self.client.put("/api/calendar", json={"window_start": now.isoformat(), "window_end": (now+timedelta(days=7)).isoformat(), "events": [event]})
        with database() as db:
            db.execute("UPDATE calendar_sync SET synced_at=?", ((now-timedelta(hours=25)).isoformat(),))
        self.client.post("/api/calendar/manual", json={"starts_at": event["starts_at"], "ends_at": event["ends_at"]})
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 2)
        self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30, "use_calendar": True}).status_code, 409)

    def test_manual_calendar_concurrent_add_and_user_isolation(self):
        now = datetime.now(timezone.utc)
        def add(offset):
            return self.client.post("/api/calendar/manual", json={"starts_at": (now+timedelta(hours=offset)).isoformat(), "ends_at": (now+timedelta(hours=offset+1)).isoformat()}).status_code
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(add, range(1, 5))), [200]*4)
        self.assertEqual(len(self.client.get("/api/calendar").json()["events"]), 4)
        other = self.client.post("/api/auth/register", json={**self.credentials, "username": "other_user"}).json()
        self.client.headers["Authorization"] = "Bearer " + other["token"]
        self.assertEqual(self.client.get("/api/calendar").json()["events"], [])
