import assert from "node:assert/strict";
import test from "node:test";
import { deadlinePassed, taskStats } from "../taskStats.ts";

const now = Date.parse("2026-11-02T12:00:00+09:00");
const task = (completed = false, deadline = null) => ({ id: 1, title: "確認する", minutes: 10,
  deadline, priority: "medium", concentration: "low", place: "", completed });

test("0件なら件数と完了率はすべて0になる", () => {
  assert.deepEqual(taskStats([], now), { total: 0, done: 0, open: 0, overdue: 0, rate: 0 });
});

test("全部完了なら100%、全部未完了なら0%になる", () => {
  assert.deepEqual(taskStats([task(true), task(true)], now), { total: 2, done: 2, open: 0, overdue: 0, rate: 100 });
  assert.deepEqual(taskStats([task(), task()], now), { total: 2, done: 0, open: 2, overdue: 0, rate: 0 });
});

test("混在時の完了率を四捨五入し、入力を変更しない", () => {
  const tasks = Object.freeze([Object.freeze(task(true)), Object.freeze(task()), Object.freeze(task())]);
  assert.deepEqual(taskStats(tasks, now), { total: 3, done: 1, open: 2, overdue: 0, rate: 33 });
  assert.equal(taskStats([task(true), task(true), task()], now).rate, 67);
});

test("未完了だけを締切切れとして数え、締切なしと完了済みを除く", () => {
  const tasks = [task(false, "2026-11-01"), task(false, "2026-11-02T11:59"),
    task(true, "2026-11-01"), task(true, "2026-11-02T11:59"), task(),
    task(false, "2026-11-02"), task(false, "2026-11-02T12:01")];
  assert.deepEqual(taskStats(tasks, now), { total: 7, done: 2, open: 5, overdue: 2, rate: 29 });
});

test("日付のみの締切は日本時間の翌日0時から締切切れになる", () => {
  const midnight = Date.parse("2026-11-03T00:00:00+09:00");
  assert.equal(deadlinePassed("2026-11-02", midnight - 1), false);
  assert.equal(deadlinePassed("2026-11-02", midnight), true);
});

test("時刻付きの締切は日本時間の指定時刻ちょうどから締切切れになる", () => {
  assert.equal(deadlinePassed("2026-11-02T12:00", now - 1), false);
  assert.equal(deadlinePassed("2026-11-02T12:00", now), true);
  assert.equal(deadlinePassed(null, now), false);
});
