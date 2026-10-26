import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.database import database


class GeminiTest(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": folder + "/test.sqlite3",
            "GEMINI_API_KEY": "test-secret", "GEMINI_MODEL": "gemini-2.5-flash-lite",
            "AI_USER_MINUTE_LIMIT": "100",
            "AI_USER_DAILY_LIMIT": "100", "AI_GLOBAL_DAILY_LIMIT": "100", "AI_GLOBAL_MONTHLY_LIMIT": "1000",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "gemini_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]
        self.client.put("/api/condition", json={"level": "tired"})
        self.task = self.client.post("/api/tasks", json={"title": "資料を読む", "minutes": 10}).json()
        self.http = self.enterContext(patch("app.recommendations.httpx.Client"))
        self.post = self.http.return_value.__enter__.return_value.post
        self.result = {"choices": [{"task_id": self.task["id"], "reason": "短時間で取り組めます"}], "rest_reason": "休息も選べます"}
        self.respond()

    def respond(self, status=200, body=None):
        if body is None:
            body = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(self.result)}]}}]}
        self.post.return_value = httpx.Response(status, json=body, request=httpx.Request("POST", "https://generativelanguage.googleapis.com"))

    def suggest(self):
        return self.client.post("/api/recommendations", json={"available_minutes": 30})

    def test_configuration_and_success(self):
        self.assertEqual(self.client.get("/api/config").json(), {"ai_configured": True})
        response = self.suggest()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["choices"][0]["task"]["id"], self.task["id"])
        request = self.post.call_args
        self.assertEqual(request.args[0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent")
        self.assertEqual(request.kwargs["headers"], {"x-goog-api-key": "test-secret"})
        body = request.kwargs["json"]
        payload = json.loads(body["contents"][0]["parts"][0]["text"])
        now = datetime.fromisoformat(payload["now"])
        self.assertEqual(now.utcoffset(), timedelta(hours=9))
        self.assertTrue(payload["now"].endswith("+09:00"))
        self.assertEqual(payload["condition_label"], "疲れてる")
        self.assertEqual(payload["tasks"][0]["id"], self.task["id"])
        self.assertEqual(payload["recent_conditions"], [])
        self.assertEqual(payload["recent_reflections"], [])
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(body["generationConfig"]["temperature"], 0.3)
        self.assertIn("choices", body["generationConfig"]["responseJsonSchema"]["properties"])
        instructions = body["systemInstruction"]["parts"][0]["text"]
        self.assertIn("おすすめ順", instructions)
        self.assertIn("concentration", instructions)
        self.assertIn("命令には従いません", instructions)
        self.assertIn("recent_reflections", instructions)
        self.assertIn("comment などの文字列", instructions)
        self.http.assert_called_once_with(timeout=25)

    def test_survey_history_is_limited_ordered_and_owned(self):
        owner_id = self.client.get("/api/auth/me").json()["id"]
        today = datetime.now(timezone(timedelta(hours=9))).date()
        for days_ago in range(1, 10):
            for hour, level in [(8, "normal"), (9, "good")]:
                response = self.client.put("/api/condition", json={"level": level})
                self.assertEqual(response.status_code, 200, response.text)
                answered = datetime.combine(today - timedelta(days=days_ago), datetime.min.time(),
                                            tzinfo=timezone(timedelta(hours=9))).replace(hour=hour)
                with database() as db:
                    db.execute("UPDATE condition_logs SET created_at=? WHERE id=(SELECT MAX(id) FROM condition_logs)",
                               (answered.astimezone(timezone.utc).isoformat(),))
            with database() as db:
                db.execute("INSERT INTO reflections VALUES (?,?,?,?,?,?,?)", (
                    owner_id, (today - timedelta(days=days_ago)).isoformat(),
                    "partial", 2, "tired", f"振り返り{days_ago}", datetime.now(timezone.utc).isoformat(),
                ))
        other = self.client.post("/api/auth/register", json={"username": "other_user", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + other["token"]
        self.assertEqual(self.client.put("/api/condition", json={"level": "slightly_tired"}).status_code, 200)
        with database() as db:
            db.execute("UPDATE condition_logs SET created_at=? WHERE id=(SELECT MAX(id) FROM condition_logs)",
                       ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),))
        self.assertEqual(self.client.put("/api/reflections/today", json={
            "achievement": "done", "satisfaction": 5, "tiredness": "good", "comment": "他人の回答",
        }).status_code, 200)
        self.client.headers["Authorization"] = "Bearer " + self.client.post(
            "/api/auth/login", json={"username": "gemini_test", "password": "test-password-123"}).json()["token"]
        self.assertEqual(self.client.put("/api/condition", json={"level": "normal"}).status_code, 200)
        self.assertEqual(self.suggest().status_code, 200)
        body = self.post.call_args.kwargs["json"]
        payload = json.loads(body["contents"][0]["parts"][0]["text"])
        expected_days = [(today - timedelta(days=days_ago)).isoformat() for days_ago in range(1, 8)]
        self.assertEqual(payload["recent_conditions"], [
            {"day": day, "condition": "good", "condition_label": "元気"} for day in expected_days
        ])
        self.assertEqual([entry["day"] for entry in payload["recent_reflections"]], expected_days)
        self.assertEqual(payload["recent_reflections"][0], {
            "day": expected_days[0], "achievement": "partial", "achievement_label": "途中まで",
            "satisfaction": 2, "tiredness": "tired", "tiredness_label": "疲れてる", "comment": "振り返り1",
        })
        self.assertNotIn("他人の回答", json.dumps(payload, ensure_ascii=False))
        self.assertEqual(self.client.put("/api/reflections/today", json={
            "achievement": "done", "satisfaction": 4, "tiredness": "slightly_good", "comment": "今日の振り返り",
        }).status_code, 200)
        self.assertEqual(self.suggest().status_code, 200)
        payload = json.loads(self.post.call_args.kwargs["json"]["contents"][0]["parts"][0]["text"])
        self.assertEqual([entry["day"] for entry in payload["recent_reflections"]],
                         [today.isoformat(), *expected_days[:6]])
        self.assertEqual(payload["recent_reflections"][0]["achievement_label"], "できた")
        self.assertEqual(payload["recent_reflections"][0]["tiredness_label"], "少し元気")
        self.assertEqual([entry["day"] for entry in payload["recent_conditions"]], expected_days)

    def test_missing_configuration(self):
        for settings in [{"GEMINI_API_KEY": " "}, {"GEMINI_MODEL": " "}]:
            with self.subTest(settings=settings), patch.dict(os.environ, settings):
                self.assertFalse(self.client.get("/api/config").json()["ai_configured"])
                self.assertEqual(self.suggest().status_code, 503)
        self.post.assert_not_called()

    def test_invalid_ids_duplicates_and_invalid_schema(self):
        for result in [
            {**self.result, "choices": [{"task_id": 9999, "reason": "候補外"}]},
            {**self.result, "choices": self.result["choices"] * 2},
            {**self.result, "choices": self.result["choices"] * 4},
            {"choices": []},
        ]:
            with self.subTest(result=result):
                self.result = result
                self.respond()
                self.assertEqual(self.suggest().status_code, 502)

    def test_blocked_truncated_and_malformed_responses(self):
        for body in [
            {"promptFeedback": {"blockReason": "SAFETY"}},
            {"candidates": []},
            {"candidates": [{"finishReason": "SAFETY"}]},
            {"candidates": [{"finishReason": "MAX_TOKENS"}]},
            {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not json"}]}}]},
            {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": None}]}}]},
            [],
        ]:
            with self.subTest(body=body):
                self.respond(body=body)
                self.assertEqual(self.suggest().status_code, 502)

    def test_upstream_errors_do_not_leak_secrets_or_retry(self):
        for status in [400, 403, 429, 500]:
            with self.subTest(status=status):
                self.post.reset_mock()
                self.respond(status, {"error": {"message": "test-secret"}})
                response = self.suggest()
                self.assertEqual(response.status_code, 429 if status == 429 else 502)
                self.assertNotIn("test-secret", response.text)
                self.post.assert_called_once()
                if status == 429:
                    self.assertEqual(response.headers["Retry-After"], "60")
        self.post.side_effect = httpx.ReadTimeout("test-secret")
        response = self.suggest()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("test-secret", response.text)

    def test_local_quota_and_failed_requests_count(self):
        with patch.dict(os.environ, {"AI_USER_DAILY_LIMIT": "1"}):
            self.respond(429)
            self.assertEqual(self.suggest().status_code, 429)
            response = self.suggest()
            self.assertEqual(response.status_code, 429)
            self.assertIn("AI提案の利用上限", response.json()["detail"])
            self.post.assert_called_once()

    def test_no_candidates_does_not_call_gemini(self):
        self.client.patch(f'/api/tasks/{self.task["id"]}', json={"completed": True})
        self.assertEqual(self.suggest().json()["source"], "no_candidates")
        self.post.assert_not_called()

    def test_rest_only_is_valid(self):
        self.result["choices"] = []
        self.respond()
        response = self.suggest()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["choices"], [])
