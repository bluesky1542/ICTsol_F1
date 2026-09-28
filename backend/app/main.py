from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ICTsol F1 API", version="0.1.0")

# 開発用Web画面からの接続を許可する。認証導入時は許可元を限定する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "バックエンドは正常に動作しています"}


@app.get("/api/hello")
def hello() -> dict[str, str]:
    return {"message": "スマホアプリからの接続に成功しました"}
