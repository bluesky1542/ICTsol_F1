from app.auth import token_hash
from app.database import database


def current_user_id(client):
    """テストクライアントのトークンから、ログイン中のユーザーIDを読む（画面では使わないため専用APIは置かない）。"""
    token = client.headers["Authorization"].split()[1]
    with database() as db:
        return db.execute("SELECT user_id FROM sessions WHERE token_hash=?", (token_hash(token),)).fetchone()["user_id"]
