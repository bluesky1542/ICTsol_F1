import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def database():
    path = Path(os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parents[1] / "data" / "app.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize():
    with database() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL, minutes INTEGER NOT NULL,
                deadline TEXT, priority TEXT NOT NULL,
                concentration TEXT NOT NULL, place TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS conditions (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                level TEXT NOT NULL, updated_at TEXT NOT NULL
            );
        """)
        # 既存の匿名データは所有者を推測せず保持し、ログイン利用者には公開しない。
        if "user_id" not in {row[1] for row in db.execute("PRAGMA table_info(tasks)")}:
            db.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_attempts (
                bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, started_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_conditions (
                user_id INTEGER PRIMARY KEY, level TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS calendar_events (
                user_id INTEGER NOT NULL, event_key TEXT NOT NULL,
                starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
                PRIMARY KEY (user_id, event_key)
            );
            CREATE TABLE IF NOT EXISTS calendar_sync (
                user_id INTEGER PRIMARY KEY, synced_at TEXT NOT NULL,
                window_start TEXT NOT NULL, window_end TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(user_id);
        """)


def tasks(user_id):
    with database() as db:
        return [dict(row) for row in db.execute("SELECT * FROM tasks WHERE user_id=? ORDER BY completed, id DESC", (user_id,))]
