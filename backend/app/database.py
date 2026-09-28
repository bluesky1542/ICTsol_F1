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


def tasks():
    with database() as db:
        return [dict(row) for row in db.execute("SELECT * FROM tasks ORDER BY completed, id DESC")]
