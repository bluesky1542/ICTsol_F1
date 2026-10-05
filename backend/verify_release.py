import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient


def main():
    web_dist = Path(os.environ.get("WEB_DIST_PATH", "../mobile/dist")).resolve()
    if not (web_dist / "index.html").is_file():
        raise SystemExit("先にmobileでWeb版を書き出してください。")
    with tempfile.TemporaryDirectory() as folder:
        # 本物のデータとAPIキーは使用しない。
        os.environ.update(REQUIRE_DATABASE_URL="0", DATABASE_URL="", DATABASE_PATH=str(Path(folder) / "test.sqlite3"), WEB_DIST_PATH=str(web_dist), OPENAI_API_KEY="", OPENAI_MODEL="")
        from app.main import app
        with TestClient(app) as client:
            assert client.get("/").status_code == 200
            for asset in web_dist.glob("_expo/static/js/web/*.js"):
                assert client.get("/" + str(asset.relative_to(web_dist))).status_code == 200
            assert client.get("/api/health").status_code == 200
            assert client.get("/api/tasks").status_code == 401
            for path in ["/.env", "/app/database.py", "/data/app.sqlite3", "/../backend/.env"]:
                assert client.get(path).status_code == 404
            result = client.post("/api/auth/register", json={"username": "release_test", "password": "release-test-password"})
            assert result.status_code == 201
            token = result.json()["token"]
            client.headers["Authorization"] = "Bearer " + token
            task = client.post("/api/tasks", json={"title": "再起動の確認", "minutes": 15}).json()
            assert client.put("/api/condition", json={"level": "slightly_good"}).status_code == 200
            assert client.post("/api/activities", json={"task_id": task["id"]}).status_code == 201
        # サーバーの起動処理を再実行しても保存内容が残ることを確認する。
        with TestClient(app) as client:
            client.headers["Authorization"] = "Bearer " + token
            assert client.get("/api/tasks").json()[0]["title"] == "再起動の確認"
            assert client.get("/api/activities").json()[0]["task_title"] == "再起動の確認"
            assert client.get("/api/condition").json()["level"] == "slightly_good"
            assert client.post("/api/auth/logout").status_code == 200
            assert client.get("/api/tasks").status_code == 401
    print("Web配信・認証・履歴・再起動後の保存確認: OK")


if __name__ == "__main__":
    main()
