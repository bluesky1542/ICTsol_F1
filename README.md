# ICTsol_F1

ICTソリューション実践のF1班の作業リポジトリです。

## 開発メンバー

- 永井松太郎
- 大橋縁史
- Gao ZiQi
- 高原拓詩
- 伊藤碧天

## 開発するアプリ

疲労度や予定状況を考慮して、利用者が取り組みやすいタスクを提案するスマホアプリです。

## 技術構成

- スマホアプリ：Expo + React Native + TypeScript
- バックエンド：Python + FastAPI
- 生成AI：Python SDK

詳しい方針は [`docs/開発方針.md`](docs/開発方針.md) を確認してください。

## 構成

- `mobile/`: スマホアプリ（Webでの動作確認にも対応）
- `backend/`: API サーバー
- `docs/`: 開発方針・仕様書・議事録

現在は1人用のローカル試作版です。タスクの登録・編集・完了、疲労度の保存、SQLiteへの永続化、生成AIによる候補と理由の提案を実装しています。ログイン・ユーザーごとのデータ分離・カレンダー連携は未実装です。同じサーバーを使う端末は同じデータを共有するため、このまま公開しないでください。

## 必要な環境

- Node.js：24系 LTS（24.3.0以上を使用し、チームでバージョンを揃える。今回の検証環境は26.0.0）
- Python 3.10 以上（動作確認環境は 3.13）
- 実機で試す場合：SDK 57 対応の Expo Go

## 起動方法

### バックエンド

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

各コマンドはリポジトリ直下から開始してください。Pythonの実行コマンドは自分の環境に合わせて変更します（`python3 --version` で確認）。Windows PowerShellでは仮想環境の有効化に `.venv\Scripts\Activate.ps1` を使います。

PCで `http://localhost:8000/api/health` を開くと応答を確認できます。API一覧は `http://localhost:8000/docs` にあります。

### スマホアプリ

別のターミナルで実行します。

```bash
cd mobile
npm ci
```

`mobile/.env.example` を同じフォルダに `.env` という名前でコピーし、接続先を設定します。

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.100:8000
```

`192.168.1.100` は例です。PCのネットワーク設定に表示されるLAN内IPアドレスに置き換えてください。

- 実機：PCのLAN内IPを指定し、スマホとPCを同じWi-Fiへ接続します。まずスマホのブラウザで `http://PCのIP:8000/api/health` が開けることを確認してください。
- Android標準エミュレーター：`http://10.0.2.2:8000`
- iOSシミュレーター・PCブラウザ：`http://localhost:8000`

設定後、`mobile/` で実行します。

```bash
npm start
```

Expo Go でQRコードを読み取るとタスク管理画面が開きます。接続先を変更した場合は開発サーバーを再起動してアプリを再読み込みします。Expo Go のSDK不一致が出た場合は対応版へ更新するか、開発ビルドを使用してください。

Webで確認する場合は `mobile/` で実行します（`.env` がない場合、Webのみ `http://localhost:8000` を使用）。

```bash
npm run web
```

表示されたURLをブラウザで開いてください。

## 開発時の確認

バックエンドのテストは `backend/` で以下を実行します。テストは一時DBと偽のAI応答を使用し、実際のAPI利用料金は発生しません。

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

`mobile/` で `npm run typecheck` と `npx expo install --check` を実行します。

`.env` と `.venv/` はGitの管理対象外です。`EXPO_PUBLIC_` の設定値はアプリに含まれるため、生成AIのAPIキーは必ずバックエンド側で管理します。

バックエンドの全オリジン許可とHTTP通信はローカル開発用です。公開時はHTTPS・認証・許可するWebオリジンを設定します。

## AI提案を使う

1. `backend/.env.example` を `backend/.env` としてコピーする。
2. `OPENAI_API_KEY` と `OPENAI_MODEL` を設定する。モデルIDは自分のOpenAI APIアカウントで利用できる、Responses APIとStructured Outputsに対応したものを指定する。
3. バックエンドを再起動し、画面の「最新の状態に更新」を押す。
4. タスクと今の調子を登録し、空き時間・場所を入力して「AIの提案を取得」を押す。

APIキーはチャットやGitHubに貼らず、バックエンドの `.env` にだけ設定してください。APIキー・モデルが未設定でもタスク管理は利用できますが、AI提案は無効になります。

AIには未完了かつ所要時間・場所に合う候補を最大30件送信し、最大3件の代替候補と理由、休息の理由を受け取ります。入力した状態をそのまま利用する初期版で、5段階の疲労度推定は未実装です。AIは[公式のStructured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)を使用し、候補外ID・重複・拒否・タイムアウトはエラーとして扱います。

提案取得時にはタスク名・締切・優先度・集中度・所要時間・場所・入力した調子をOpenAIへ送信し、API利用料金が発生します。候補がない場合はAIを呼び出さず、その旨を表示します。エラー時に偽のAI提案を表示することはありません。

データは `backend/data/app.sqlite3` に保存され、Gitには含まれません。保存先はサーバーの環境変数 `DATABASE_PATH` で変更できます。タスク・調子は永続化しますが、提案と「取り組む／休息」の選択は画面内のみです。

### 依存関係の監査メモ

2026-09-28の `npm audit` で、Expoの内部依存 `xcode → uuid` に由来する中程度の警告が10件（依存元への波及を含む）報告されました。高・重大は0件です。提示された修正はExpoの大幅なダウングレードを含むため、`npm audit fix --force` は適用していません。上流の修正版を確認して更新してください。
