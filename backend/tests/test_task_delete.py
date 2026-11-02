import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class TaskDeleteCases:
    def delete_task_input(self, **changes):
        response = self.client.post("/api/tasks", json={"title": "削除の確認", "minutes": 10, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def delete_tasks_list(self):
        return {task["id"]: task for task in self.client.get("/api/tasks").json()}

    def delete_checked(self, task):
        response = self.client.delete(f'/api/tasks/{task["id"]}')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")

    def test_delete_leaf_and_get(self):
        leaf = self.delete_task_input()
        other = self.delete_task_input()
        self.delete_checked(leaf)
        self.assertNotIn(leaf["id"], self.delete_tasks_list())
        self.assertIn(other["id"], self.delete_tasks_list())

    def test_delete_missing_is_404(self):
        task = self.delete_task_input()
        self.delete_checked(task)
        response = self.client.delete(f'/api/tasks/{task["id"]}')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "タスクが見つかりません")

    def test_delete_other_users_task_is_404(self):
        task = self.delete_task_input()
        session = self.client.post("/api/auth/register", json={
            "username": "del_" + os.urandom(8).hex(), "password": "test-password-123",
        }).json()
        response = self.client.delete(f'/api/tasks/{task["id"]}', headers={"Authorization": "Bearer " + session["token"]})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "タスクが見つかりません")
        self.assertIn(task["id"], self.delete_tasks_list())

    def test_delete_preserves_activity_history(self):
        task = self.delete_task_input()
        self.assertEqual(self.client.put("/api/condition", json={"level": "normal"}).status_code, 200)
        response = self.client.post("/api/activities", json={"task_id": task["id"]})
        self.assertEqual(response.status_code, 201, response.text)
        activity = response.json()
        self.delete_checked(task)
        response = self.client.get("/api/activities")
        self.assertEqual(response.status_code, 200)
        saved = next(entry for entry in response.json() if entry["id"] == activity["id"])
        self.assertEqual(saved["task_id"], task["id"])
        self.assertEqual(saved["task_title"], task["title"])


class SQLiteTaskDeleteTest(TaskDeleteCases, unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": folder + "/delete.sqlite3", "GEMINI_API_KEY": "",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "delete_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]
