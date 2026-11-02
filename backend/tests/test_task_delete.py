import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import database, lock_tasks
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

    def test_delete_heading_and_grandchildren(self):
        heading = self.delete_task_input()
        child = self.delete_task_input(parent_id=heading["id"])
        grandchild = self.delete_task_input(parent_id=child["id"])
        done = self.delete_task_input(parent_id=heading["id"])
        self.assertEqual(self.client.patch(f'/api/tasks/{done["id"]}', json={"completed": True}).status_code, 200)
        self.delete_checked(heading)
        self.assertTrue({heading["id"], child["id"], grandchild["id"], done["id"]}.isdisjoint(self.delete_tasks_list()))

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

    def test_delete_incomplete_child_completes_ancestors(self):
        root = self.delete_task_input()
        heading = self.delete_task_input(parent_id=root["id"])
        done = self.delete_task_input(parent_id=heading["id"])
        pending = self.delete_task_input(parent_id=heading["id"])
        self.assertEqual(self.client.patch(f'/api/tasks/{done["id"]}', json={"completed": True}).status_code, 200)
        self.delete_checked(pending)
        current = self.delete_tasks_list()
        self.assertTrue(current[heading["id"]]["completed"])
        self.assertTrue(current[root["id"]]["completed"])

    def test_delete_last_child_preserves_state_and_allows_patch(self):
        for completed in [False, True]:
            with self.subTest(completed=completed):
                heading = self.delete_task_input()
                child = self.delete_task_input(parent_id=heading["id"])
                self.assertEqual(self.client.patch(f'/api/tasks/{child["id"]}', json={"completed": completed}).status_code, 200)
                self.delete_checked(child)
                self.assertEqual(self.delete_tasks_list()[heading["id"]]["completed"], completed)
                response = self.client.patch(f'/api/tasks/{heading["id"]}', json={"completed": not completed})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["completed"], not completed)

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

    def test_delete_deep_tree_and_cycle_terminate(self):
        root = self.delete_task_input()
        parent_id = root["id"]
        user_id = self.client.get("/api/auth/me").json()["id"]
        with database() as db:
            lock_tasks(db, user_id)
            for _ in range(1100):
                parent_id = db.execute(
                    "INSERT INTO tasks (title,minutes,priority,concentration,place,parent_id,user_id) "
                    "VALUES (?,10,'medium','medium','',?,?) RETURNING id", ("深い子", parent_id, user_id),
                ).fetchone()["id"]
            db.execute("UPDATE tasks SET parent_id=? WHERE id=?", (parent_id, root["id"]))
        self.delete_checked(root)
        self.assertNotIn(parent_id, self.delete_tasks_list())
        self.assertNotIn(root["id"], self.delete_tasks_list())


class SQLiteTaskDeleteTest(TaskDeleteCases, unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": folder + "/delete.sqlite3", "GEMINI_API_KEY": "",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "delete_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]
