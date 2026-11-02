import os
from datetime import datetime, timezone
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import psycopg
from psycopg.rows import dict_row

IntegrityErrors = (sqlite3.IntegrityError, psycopg.IntegrityError)
DatabaseErrors = (sqlite3.DatabaseError, psycopg.Error)


class PostgresDatabase:
    def __init__(self, connection):
        self.connection = connection

    @staticmethod
    def query(sql, parameters):
        # アプリ内の固定SQLだけを変換する。入力値はドライバーに別途渡す。
        if isinstance(parameters, dict):
            return re.sub(r":([a-zA-Z_][a-zA-Z_0-9]*)", r"%(\1)s", sql)
        return sql.replace("?", "%s")

    def execute(self, sql, parameters=None):
        return self.connection.execute(self.query(sql, parameters), parameters)

    def executemany(self, sql, parameters):
        with self.connection.cursor() as cursor:
            cursor.executemany(self.query(sql, None), parameters)

    def executescript(self, sql):
        # 初期化用DDLは単純な文のみ。関数定義やユーザー入力は扱わない。
        for statement in sql.split(";"):
            if statement.strip():
                self.execute(statement)


def lock_auth(db):
    if isinstance(db, PostgresDatabase):
        # 複数のサーバーでもログイン試行回数の更新を直列化する。
        db.execute("SELECT pg_advisory_xact_lock(73120401)")
    else:
        db.execute("BEGIN IMMEDIATE")


def lock_tasks(db, user_id):
    if isinstance(db, PostgresDatabase):
        db.execute("SELECT pg_advisory_xact_lock(73120403, ?)", (user_id,))
    else:
        db.execute("BEGIN IMMEDIATE")


def migrate_tree_to_groups(db):
    """親子（ツリー）をやめてグループに一本化したときの移行。何度実行しても結果は同じ。

    子を持つタスク（見出し）ごとに、最上位の見出しの題名のグループを作り（同名があれば使う）、
    中の子を持たないタスクをそのグループに入れて最上位に出す。見出し自体は削除する。
    """
    rows = db.execute("SELECT id,user_id,title,parent_id FROM tasks WHERE user_id IS NOT NULL").fetchall()
    tasks = {row["id"]: row for row in rows}
    headings = {row["parent_id"] for row in rows if row["parent_id"] is not None}
    if not headings:
        return
    now = datetime.now(timezone.utc).isoformat()
    groups = {}
    for row in rows:
        if row["parent_id"] is None or row["id"] in headings:
            continue
        # 最上位の見出しまでたどる（循環データでも止まる）。
        root, seen = row["id"], set()
        while tasks.get(root) is not None and tasks[root]["parent_id"] in tasks and root not in seen:
            seen.add(root)
            root = tasks[root]["parent_id"]
        owner, name = row["user_id"], (tasks[root]["title"].strip() or "グループ")[:30]
        if (owner, name) not in groups:
            found = db.execute("SELECT id FROM task_groups WHERE user_id=? AND name=?", (owner, name)).fetchone()
            groups[(owner, name)] = found["id"] if found else db.execute(
                "INSERT INTO task_groups (user_id,name,created_at) VALUES (?,?,?) RETURNING id", (owner, name, now),
            ).fetchone()["id"]
        db.execute("UPDATE tasks SET group_id=?, parent_id=NULL WHERE id=?", (groups[(owner, name)], row["id"]))
    for heading in headings:
        db.execute("DELETE FROM tasks WHERE id=?", (heading,))
    # 子を持たないまま親だけ残った行（見出しが消えていたなど）も最上位に戻す。
    db.execute("UPDATE tasks SET parent_id=NULL WHERE parent_id IS NOT NULL")


@contextmanager
def database():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        parsed = urlsplit(url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError("DATABASE_URLにはPostgreSQLの接続URLを設定してください。")
        options = {} if "sslmode" in parse_qs(parsed.query) else {"sslmode": "require"}
        with psycopg.connect(url, row_factory=dict_row, connect_timeout=10, prepare_threshold=None, **options) as connection:
            connection.execute("SET LOCAL search_path TO ictsol")
            yield PostgresDatabase(connection)
        return
    if os.getenv("REQUIRE_DATABASE_URL") == "1":
        raise RuntimeError("公開環境ではDATABASE_URLの設定が必要です。")
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
        postgres = isinstance(db, PostgresDatabase)
        if postgres:
            db.execute("SELECT pg_advisory_xact_lock(73120402)")
            db.execute("CREATE SCHEMA IF NOT EXISTS ictsol")
            db.execute("REVOKE ALL ON SCHEMA ictsol FROM PUBLIC")
        initial_schema = """
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
        """
        if postgres:
            initial_schema = initial_schema.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
        db.executescript(initial_schema)
        # 既存の匿名データは所有者を推測せず保持し、ログイン利用者には公開しない。
        if postgres:
            db.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id INTEGER")
        elif "user_id" not in {row[1] for row in db.execute("PRAGMA table_info(tasks)")}:
            db.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER")
        if postgres:
            db.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id INTEGER")
        elif "parent_id" not in {row[1] for row in db.execute("PRAGMA table_info(tasks)")}:
            db.execute("ALTER TABLE tasks ADD COLUMN parent_id INTEGER")
        db.execute("CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(user_id, parent_id)")
        if postgres:
            db.execute("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_id INTEGER")
        elif "group_id" not in {row[1] for row in db.execute("PRAGMA table_info(tasks)")}:
            db.execute("ALTER TABLE tasks ADD COLUMN group_id INTEGER")
        db.execute("CREATE INDEX IF NOT EXISTS tasks_group ON tasks(user_id, group_id)")
        schema = """
            CREATE TABLE IF NOT EXISTS task_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS task_groups_owner_name ON task_groups(user_id, name);
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
            CREATE TABLE IF NOT EXISTS condition_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL, level TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS condition_logs_owner_time ON condition_logs(user_id, created_at);
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
            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL, task_id INTEGER,
                task_title TEXT, condition_level TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS activities_owner ON activities(user_id, id DESC);
            CREATE TABLE IF NOT EXISTS ai_usage (
                bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reflections (
                user_id INTEGER NOT NULL, day TEXT NOT NULL,
                achievement TEXT NOT NULL, satisfaction INTEGER NOT NULL,
                tiredness TEXT NOT NULL, comment TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS work_plans (
                user_id INTEGER NOT NULL, day TEXT NOT NULL,
                end_time TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, day)
            );
        """
        if postgres:
            schema = schema.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
            schema = schema.replace("id INTEGER PRIMARY KEY, username", "id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, username")
            schema = schema.replace(" REAL ", " DOUBLE PRECISION ")
        db.executescript(schema)
        # 取り組みモード用の列。既存行は NULL のまま（kind は task_id の有無から読み替える）。
        columns = {"kind": "TEXT", "rank": "INTEGER", "planned_minutes": "INTEGER",
                   "ends_at": "TEXT", "outcome": "TEXT", "ended_at": "TEXT"}
        existing = set() if postgres else {row[1] for row in db.execute("PRAGMA table_info(activities)")}
        for name, kind in columns.items():
            if postgres:
                db.execute(f"ALTER TABLE activities ADD COLUMN IF NOT EXISTS {name} {kind}")
            elif name not in existing:
                db.execute(f"ALTER TABLE activities ADD COLUMN {name} {kind}")
        migrate_tree_to_groups(db)
        if postgres:
            # Supabaseのブラウザ用APIからアプリの内部テーブルを参照させない。
            for role in ("PUBLIC", "anon", "authenticated"):
                if role != "PUBLIC" and not db.execute("SELECT 1 FROM pg_roles WHERE rolname=?", (role,)).fetchone():
                    continue
                db.execute(f"REVOKE ALL ON SCHEMA ictsol FROM {role}")
                db.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA ictsol FROM {role}")
                db.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA ictsol FROM {role}")


def tasks(user_id):
    with database() as db:
        return [dict(row) for row in db.execute("SELECT * FROM tasks WHERE user_id=? ORDER BY completed, id DESC", (user_id,))]
