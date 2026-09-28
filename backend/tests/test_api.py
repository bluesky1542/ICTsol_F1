import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.models import AIChoice, AIResult


class APITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"DATABASE_PATH": self.temp.name + "/test.sqlite3", "OPENAI_API_KEY": "", "OPENAI_MODEL": ""})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def create(self, **changes):
        response = self.client.post("/api/tasks", json={"title": "レポート", "minutes": 20, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def ready(self):
        self.client.put("/api/condition", json={"level": "tired"})

    def test_persistence_edit_completion_and_validation(self):
        task = self.create()
        with TestClient(app) as other:
            self.assertEqual(other.get("/api/tasks").json()[0]["id"], task["id"])
        response = self.client.put(f'/api/tasks/{task["id"]}', json={"title": "更新", "minutes": 10})
        self.assertEqual(response.json()["title"], "更新")
        self.assertTrue(self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": True}).json()["completed"])
        for data in [{"title": " ", "minutes": 20}, {"title": "a", "minutes": 0}, {"title": "a", "minutes": 1, "deadline": "2026-02-30"}]:
            self.assertEqual(self.client.post("/api/tasks", json=data).status_code, 422)
        self.assertEqual(self.client.patch("/api/tasks/999", json={"completed": True}).status_code, 404)

    def test_missing_condition_and_key(self):
        self.create()
        self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 409)
        self.ready()
        self.assertEqual(self.client.get("/api/condition").json()["level"], "tired")
        self.assertFalse(self.client.get("/api/config").json()["ai_configured"])
        self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 503)

    def test_candidate_filter_and_no_candidates(self):
        self.ready()
        self.create(minutes=60)
        self.create(place="学校")
        completed = self.create()
        self.client.patch(f'/api/tasks/{completed["id"]}', json={"completed": True})
        with patch("app.recommendations.generate") as generate:
            result = self.client.post("/api/recommendations", json={"available_minutes": 30, "place": "自宅"})
            self.assertEqual(result.json()["source"], "no_candidates")
            generate.assert_not_called()
        valid = self.create(place="自宅")
        with patch("app.recommendations.generate", return_value=AIResult(choices=[AIChoice(task_id=valid["id"], reason="短時間で取り組めます")], rest_reason="休息も選べます")) as generate:
            result = self.client.post("/api/recommendations", json={"available_minutes": 30, "place": "自宅"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual([t["id"] for t in generate.call_args.args[0]], [valid["id"]])
            self.assertEqual(result.json()["choices"][0]["task"]["id"], valid["id"])

    def test_invalid_ai_ids_refusal_timeout_and_success(self):
        self.ready()
        task = self.create()
        valid = AIChoice(task_id=task["id"], reason="短時間で取り組めます")
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test", "OPENAI_MODEL": "test-model"}), patch("app.recommendations.OpenAI") as client:
            parse = client.return_value.__enter__.return_value.responses.parse
            for choices, expected in [([valid], 200), ([AIChoice(task_id=999, reason="不正")], 502), ([valid, valid], 502)]:
                parse.return_value = SimpleNamespace(status="completed", output_parsed=AIResult(choices=choices, rest_reason="休息も選べます"))
                self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, expected)
            self.assertFalse(parse.call_args.kwargs["store"])
            parse.return_value = SimpleNamespace(status="completed", output_parsed=None)
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 502)
            from openai import APIConnectionError
            import httpx2
            parse.side_effect = APIConnectionError(request=httpx2.Request("POST", "https://api.openai.com/v1/responses"))
            response = self.client.post("/api/recommendations", json={"available_minutes": 30})
            self.assertEqual(response.status_code, 502)

    def test_changed_task_rejects_stale_suggestion(self):
        self.ready()
        task = self.create()
        def generate(*args):
            self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": True})
            return AIResult(choices=[AIChoice(task_id=task["id"], reason="理由")], rest_reason="休息")
        with patch("app.recommendations.generate", side_effect=generate):
            self.assertEqual(self.client.post("/api/recommendations", json={"available_minutes": 30}).status_code, 409)


if __name__ == "__main__":
    unittest.main()
