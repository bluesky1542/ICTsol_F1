import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, todayLog } from "../activityLog.ts";

const at = text => new Date(text).toISOString();
const entry = (id, created, changes = {}) => ({ id, task_id: 1, task_title: "資料を読む", condition_level: "normal",
  created_at: at(created), kind: "task", rank: 1, planned_minutes: 15, ends_at: at(created), outcome: "done", ended_at: null, ...changes });

test("残り時間は分:秒、1時間以上は時:分:秒で表示する", () => {
  assert.equal(formatDuration(0), "00:00");
  assert.equal(formatDuration(65_000), "01:05");
  assert.equal(formatDuration(-65_000), "01:05");
  assert.equal(formatDuration(3_723_000), "1:02:03");
});

test("今日の記録だけを日本時間の時刻順に並べる", () => {
  const now = Date.parse("2026-11-02T22:00:00+09:00");
  const log = todayLog([
    entry(3, "2026-11-02T13:00:00+09:00", { kind: "rest", task_id: null, task_title: null, planned_minutes: 15 }),
    entry(2, "2026-11-02T09:10:00+09:00"),
    entry(1, "2026-11-01T23:59:00+09:00", { task_title: "昨日の記録" }),
    entry(4, "2026-11-02T00:00:00+09:00", { outcome: "partial", task_title: "日付の境目" }),
  ], now);
  assert.deepEqual(log.map(item => [item.time, item.text]), [
    ["0:00", "日付の境目（途中まで）"], ["9:10", "資料を読む（完了）"], ["13:00", "ひと休み 15分"],
  ]);
});

test("取り組み中・中断・削除済み・旧形式の記録も表示できる", () => {
  const now = Date.parse("2026-11-02T22:00:00+09:00");
  const log = todayLog([
    entry(1, "2026-11-02T10:00:00+09:00", { outcome: null }),
    entry(2, "2026-11-02T11:00:00+09:00", { outcome: "stopped", task_title: null }),
    entry(3, "2026-11-02T12:00:00+09:00", { kind: null, rank: null, planned_minutes: null, ends_at: null, outcome: null }),
    entry(4, "2026-11-02T12:30:00+09:00", { kind: null, task_id: null, task_title: null, planned_minutes: null, ends_at: null, outcome: null }),
  ], now);
  assert.deepEqual(log.map(item => item.text), ["資料を読む（取り組み中）", "（削除したタスク）（中断）", "資料を読む", "ひと休み"]);
});
