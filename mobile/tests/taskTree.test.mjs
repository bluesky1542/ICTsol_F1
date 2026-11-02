import assert from "node:assert/strict";
import test from "node:test";
import { buildTree, descendantIds, descendantSummary } from "../taskTree.ts";

const task = (id, parent_id = null, completed = false) => ({ id, parent_id, completed,
  title: `タスク${id}`, minutes: 10, deadline: null, priority: "medium", concentration: "low", place: "" });
const compare = (first, second) => first.id - second.id;
const positions = tasks => buildTree(tasks, compare).map(row => [row.task.id, row.depth]);

test("残り時間は未完了の葉だけを合計し、締切は未完了の子孫から探す", () => {
  const tasks = Object.freeze([task(1), { ...task(2, 1), minutes: 120 },
    { ...task(3, 2), minutes: 25, deadline: "2026-11-05" },
    { ...task(4, 1), minutes: 20, deadline: "2026-11-05T18:00" },
    { ...task(5, 2, true), deadline: "2026-11-01" }, task(6)].map(Object.freeze));
  assert.deepEqual(descendantSummary(tasks, 1), { minutes: 45, deadline: "2026-11-05T18:00" });
  assert.deepEqual(descendantSummary(tasks, 3), { minutes: 0, deadline: null });
  assert.deepEqual(descendantSummary([], 99), { minutes: 0, deadline: null });
});

test("残り時間の集計は完了した見出しの下も辿り、深い階層・循環でも止まる", () => {
  assert.deepEqual(descendantSummary([task(1), task(2, 1, true), task(3, 2)], 1), { minutes: 10, deadline: null });
  assert.deepEqual(descendantSummary([task(1, 2), task(2, 1), task(3, 2)], 1), { minutes: 10, deadline: null });
  const tasks = Array.from({ length: 50000 }, (_, index) => task(index, index === 0 ? null : index - 1));
  assert.deepEqual(descendantSummary(tasks, 0), { minutes: 10, deadline: null });
});

test("親を先に、ルートと兄弟をcompare順に並べ、入力を変更しない", () => {
  const tasks = Object.freeze([task(6), task(5, 1), task(4, 2), task(3, 1), task(2, 1), task(1)]
    .map(value => Object.freeze(value)));
  assert.deepEqual(positions(tasks), [[1, 0], [2, 1], [4, 2], [3, 1], [5, 1], [6, 0]]);
  assert.deepEqual(buildTree(tasks, (first, second) => second.id - first.id).map(row => row.task.id), [6, 1, 5, 3, 2, 4]);
  assert.deepEqual(tasks.map(value => value.id), [6, 5, 4, 3, 2, 1]);
});

test("非常に深い5万段の階層も反復DFSで処理する", () => {
  const tasks = Array.from({ length: 50000 }, (_, index) => task(index, index === 0 ? null : index - 1));
  const rows = buildTree(tasks, compare);
  assert.equal(rows.length, tasks.length);
  assert.equal(rows.at(-1).depth, 49999);
  assert.deepEqual([...descendantIds(tasks, 0)], tasks.slice(1).map(value => value.id));
});

test("親が配列にいなければルートとして表示する", () => {
  assert.deepEqual(positions([task(4, 3), task(3, 99), task(1)]), [[1, 0], [3, 0], [4, 1]]);
});

test("循環と自己参照でも重複せず、通常ルートの後に残りを表示する", () => {
  const tasks = [task(1, 2), task(2, 1), task(3, 2), task(4, 4), task(5), task(6, 5)];
  assert.deepEqual(positions(tasks), [[5, 0], [6, 1], [1, 0], [2, 1], [3, 2], [4, 0]]);
  assert.deepEqual(descendantIds(tasks, 1), new Set([2, 3]));
  assert.deepEqual(descendantIds(tasks, 4), new Set());
});

test("子孫だけを返し、自分・兄弟・他のルートを含めない", () => {
  const tasks = [task(1), task(2, 1), task(3, 2), task(4, 1), task(5)];
  assert.deepEqual(descendantIds(tasks, 1), new Set([2, 3, 4]));
  assert.deepEqual(descendantIds(tasks, 2), new Set([3]));
  assert.deepEqual(descendantIds(tasks, 5), new Set());
  assert.deepEqual(descendantIds(tasks, 99), new Set());
  assert.deepEqual(buildTree([], compare), []);
});

test("直接の子の件数と完了件数を、渡された配列だけから数える", () => {
  const tasks = [task(1), task(2, 1, true), task(3, 1), task(4, 3, true)];
  assert.deepEqual(buildTree(tasks, compare).map(({ task, childCount, doneChildCount }) =>
    [task.id, childCount, doneChildCount]), [[1, 2, 1], [2, 0, 0], [3, 1, 1], [4, 0, 0]]);
  const filtered = buildTree(tasks.filter(value => !value.completed), compare);
  assert.equal(filtered[0].childCount, 1);
  assert.equal(filtered[0].doneChildCount, 0);
  assert.equal(filtered[1].childCount, 0);
});
