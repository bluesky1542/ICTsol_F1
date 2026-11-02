import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import database, initialize, lock_tasks, refresh_ancestors
from app.main import app


class TaskTreeCases:
    def create_tree_task(self, **changes):
        response = self.client.post("/api/tasks", json={"title": "確認する", "minutes": 10, **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def move(self, task, parent_id):
        return self.client.put(f'/api/tasks/{task["id"]}', json={
            "title": task["title"], "minutes": task["minutes"], "parent_id": parent_id,
        })

    def complete(self, task, completed=True):
        response = self.client.patch(f'/api/tasks/{task["id"]}', json={"completed": completed})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def tree_tasks(self):
        return {task["id"]: task for task in self.client.get("/api/tasks").json()}

    def test_tree_create_and_list(self):
        parent = self.create_tree_task()
        child = self.create_tree_task(parent_id=parent["id"])
        self.assertIsNone(parent["parent_id"])
        self.assertEqual(child["parent_id"], parent["id"])
        self.assertEqual(self.tree_tasks()[child["id"]]["parent_id"], parent["id"])
        self.assertEqual(self.client.post("/api/tasks", json={"title": "不正", "minutes": 10, "parent_id": 0}).status_code, 422)

    def test_tree_parent_is_private_and_must_exist(self):
        other = self.enterContext(TestClient(app))
        session = other.post("/api/auth/register", json={
            "username": "other_" + str(self.client.get("/api/auth/me").json()["id"]), "password": "test-password-123",
        }).json()
        other.headers["Authorization"] = "Bearer " + session["token"]
        private = other.post("/api/tasks", json={"title": "他人", "minutes": 10}).json()
        task = self.create_tree_task()
        for parent_id in (private["id"], 2147483647):
            for response in (self.client.post("/api/tasks", json={"title": "子", "minutes": 10, "parent_id": parent_id}),
                             self.move(task, parent_id)):
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "親タスクが見つかりません")

    def test_tree_rejects_self_child_grandchild_and_allows_move(self):
        parent = self.create_tree_task()
        child = self.create_tree_task(parent_id=parent["id"])
        grandchild = self.create_tree_task(parent_id=child["id"])
        unrelated = self.create_tree_task()
        for target in (parent, child, grandchild):
            response = self.move(parent, target["id"])
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "自分自身やその下のタスクは親にできません")
        self.assertEqual(self.move(child, unrelated["id"]).json()["parent_id"], unrelated["id"])
        self.assertIsNone(self.move(child, None).json()["parent_id"])
        self.move(child, parent["id"])
        response = self.client.put(f'/api/tasks/{child["id"]}', json={"title": "最上位", "minutes": 10})
        self.assertIsNone(response.json()["parent_id"])

    def test_tree_completion_two_children_and_parent_is_read_only(self):
        parent = self.create_tree_task()
        first = self.create_tree_task(parent_id=parent["id"])
        second = self.create_tree_task(parent_id=parent["id"])
        self.complete(first)
        self.assertFalse(self.tree_tasks()[parent["id"]]["completed"])
        self.complete(second)
        self.assertTrue(self.tree_tasks()[parent["id"]]["completed"])
        for completed in (True, False):
            response = self.client.patch(f'/api/tasks/{parent["id"]}', json={"completed": completed})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "子タスクがあるタスクは、子をすべて完了すると自動で完了になります")
        self.assertTrue(self.tree_tasks()[first["id"]]["completed"])

    def test_tree_completion_propagates_up_and_reopens(self):
        parent = self.create_tree_task()
        child = self.create_tree_task(parent_id=parent["id"])
        grandchild = self.create_tree_task(parent_id=child["id"])
        self.complete(grandchild)
        self.assertTrue(all(task["completed"] for task in self.tree_tasks().values()))
        self.complete(grandchild, False)
        self.assertFalse(any(task["completed"] for task in self.tree_tasks().values()))

    def test_tree_add_child_reopens_completed_ancestors(self):
        parent = self.create_tree_task()
        child = self.create_tree_task(parent_id=parent["id"])
        self.complete(child)
        self.create_tree_task(parent_id=child["id"])
        self.assertFalse(any(task["completed"] for task in self.tree_tasks().values()))

    def test_tree_move_refreshes_both_sides_and_preserves_new_leaf(self):
        ancestor = self.create_tree_task()
        old_parent = self.create_tree_task(parent_id=ancestor["id"])
        remaining = self.create_tree_task(parent_id=old_parent["id"])
        moving = self.create_tree_task(parent_id=old_parent["id"])
        new_parent = self.create_tree_task()
        self.complete(remaining)
        self.complete(new_parent)
        self.assertEqual(self.move(moving, new_parent["id"]).status_code, 200)
        current = self.tree_tasks()
        self.assertTrue(current[old_parent["id"]]["completed"])
        self.assertTrue(current[ancestor["id"]]["completed"])
        self.assertFalse(current[new_parent["id"]]["completed"])
        self.assertEqual(self.move(moving, None).status_code, 200)
        self.assertFalse(self.tree_tasks()[new_parent["id"]]["completed"])
        self.complete(new_parent)
        self.assertTrue(self.tree_tasks()[new_parent["id"]]["completed"])

    def test_tree_existing_cycle_terminates(self):
        first = self.create_tree_task()
        second = self.create_tree_task(parent_id=first["id"])
        user_id = self.client.get("/api/auth/me").json()["id"]
        with database() as db:
            lock_tasks(db, user_id)
            db.execute("UPDATE tasks SET parent_id=? WHERE id=?", (second["id"], first["id"]))
            refresh_ancestors(db, user_id, first["id"])
        unrelated = self.create_tree_task()
        self.assertEqual(self.move(unrelated, first["id"]).status_code, 200)

    def test_tree_parallel_moves_do_not_create_cycle(self):
        first = self.create_tree_task()
        second = self.create_tree_task()
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda pair: self.move(*pair), [(first, second["id"]), (second, first["id"])]))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 400])

    def test_tree_parallel_completion_refreshes_parent(self):
        parent = self.create_tree_task()
        children = [self.create_tree_task(parent_id=parent["id"]) for _ in range(2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(self.complete, children))
        self.assertTrue(self.tree_tasks()[parent["id"]]["completed"])

    def test_tree_moving_last_completed_child_keeps_old_parent_done(self):
        parent = self.create_tree_task()
        child = self.create_tree_task(parent_id=parent["id"])
        self.complete(child)
        self.assertEqual(self.move(child, None).status_code, 200)
        self.assertTrue(self.tree_tasks()[parent["id"]]["completed"])
        self.complete(parent, False)

    def test_tree_deep_completion_has_no_recursion_limit(self):
        root = self.create_tree_task()
        parent_id = root["id"]
        user_id = self.client.get("/api/auth/me").json()["id"]
        with database() as db:
            lock_tasks(db, user_id)
            for _ in range(1100):
                parent_id = db.execute(
                    "INSERT INTO tasks (title,minutes,priority,concentration,place,parent_id,user_id) "
                    "VALUES (?,10,'medium','medium','',?,?) RETURNING id", ("深い子", parent_id, user_id),
                ).fetchone()["id"]
        self.complete({"id": parent_id})
        self.assertTrue(all(task["completed"] for task in self.tree_tasks().values()))


class SQLiteTaskTreeTest(TaskTreeCases, unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "REQUIRE_DATABASE_URL": "0", "DATABASE_URL": "", "DATABASE_PATH": folder + "/tree.sqlite3", "GEMINI_API_KEY": "",
        }))
        self.client = self.enterContext(TestClient(app))
        session = self.client.post("/api/auth/register", json={"username": "tree_test", "password": "test-password-123"}).json()
        self.client.headers["Authorization"] = "Bearer " + session["token"]

    def test_tree_legacy_migration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = folder + "/legacy.sqlite3"
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, minutes INTEGER NOT NULL, "
                           "deadline TEXT, priority TEXT NOT NULL, concentration TEXT NOT NULL, place TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)")
                db.execute("INSERT INTO tasks VALUES (1,'既存',10,NULL,'medium','medium','',1)")
            with patch.dict(os.environ, {"DATABASE_PATH": path}):
                initialize()
                initialize()
                with database() as db:
                    row = db.execute("SELECT * FROM tasks WHERE id=1").fetchone()
                    self.assertIsNone(row["parent_id"])
                    self.assertEqual(row["completed"], 1)
                    self.assertIn("tasks_parent", {row[1] for row in db.execute("PRAGMA index_list(tasks)")})
