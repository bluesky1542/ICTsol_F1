import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app


class StarterDataTest(unittest.TestCase):
    """アプリから新規登録したときに、最初のグループとタスクが入ることを確かめる。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": self.temp.name + "/test.sqlite3"})
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def register(self, name, **extra):
        result = self.client.post("/api/auth/register", json={"username": name, "password": "test-password-123", **extra})
        self.assertEqual(result.status_code, 201, result.text)
        return {"Authorization": "Bearer " + result.json()["token"]}

    def test_starter_true_adds_groups_and_tasks(self):
        headers = self.register("starter_user", starter=True)
        groups = self.client.get("/api/groups", headers=headers).json()
        self.assertEqual([group["name"] for group in groups], ["授業", "課題", "生活"])
        tasks = self.client.get("/api/tasks", headers=headers).json()
        by_title = {task["title"]: task for task in tasks}
        self.assertEqual(set(by_title), {"次の授業の予習をする", "レポートのテーマを決める", "部屋を片づける"})
        names = {group["id"]: group["name"] for group in groups}
        self.assertEqual(names[by_title["レポートのテーマを決める"]["group_id"]], "課題")
        self.assertEqual(by_title["部屋を片づける"]["place"], "自宅")
        self.assertTrue(all(not task["completed"] for task in tasks))
        # 締切は日本時間の今日から3日後の日付だけ（時刻なし）。
        expected = ((datetime.now(timezone.utc) + timedelta(hours=9)).date() + timedelta(days=3)).isoformat()
        self.assertEqual(by_title["レポートのテーマを決める"]["deadline"], expected)

    def test_default_registration_stays_empty(self):
        headers = self.register("plain_user")
        self.assertEqual(self.client.get("/api/groups", headers=headers).json(), [])
        self.assertEqual(self.client.get("/api/tasks", headers=headers).json(), [])

    def test_starter_data_is_per_user(self):
        first = self.register("first_user", starter=True)
        second = self.register("second_user", starter=True)
        first_ids = {task["id"] for task in self.client.get("/api/tasks", headers=first).json()}
        second_ids = {task["id"] for task in self.client.get("/api/tasks", headers=second).json()}
        self.assertEqual(len(first_ids), 3)
        self.assertFalse(first_ids & second_ids)


if __name__ == "__main__":
    unittest.main()
