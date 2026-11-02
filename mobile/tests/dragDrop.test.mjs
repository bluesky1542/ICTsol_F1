import assert from "node:assert/strict";
import test from "node:test";
import { dropChange, dropLabel, findDropArea } from "../dragDrop.ts";

const task = (id, parent_id = null, group_id = null) => ({ id, parent_id, group_id, title: `タスク${id}`, minutes: 10,
  deadline: null, priority: "medium", concentration: "medium", place: "", completed: false });
// 1 ─ 2 ─ 3（1 はグループ7）、4 は未分類の最上位、5 はグループ8の最上位
const tasks = [task(1, null, 7), task(2, 1, 7), task(3, 2, 7), task(4), task(5, null, 8)];

test("指の位置にある落とし先を選び、重なるときは内側を優先する", () => {
  const areas = [
    { key: "group", target: { kind: "group", groupId: 7, name: "授業" }, top: 0, height: 300 },
    { key: "task:1", target: { kind: "task", id: 1 }, top: 40, height: 60 },
  ];
  assert.equal(findDropArea(areas, 50).key, "task:1");
  assert.equal(findDropArea(areas, 10).key, "group");
  assert.equal(findDropArea(areas, 100).key, "group");
  assert.equal(findDropArea(areas, 300), null);
  assert.equal(findDropArea([], 10), null);
});

test("別のタスクの上に落とすと、その子になりグループも揃う", () => {
  assert.deepEqual(dropChange(tasks, 4, { kind: "task", id: 2 }), { parent_id: 2, group_id: 7 });
  assert.deepEqual(dropChange(tasks, 3, { kind: "task", id: 5 }), { parent_id: 5, group_id: 8 });
});

test("自分自身・子孫・今の親の上には落とせない", () => {
  assert.equal(dropChange(tasks, 1, { kind: "task", id: 1 }), null);
  assert.equal(dropChange(tasks, 1, { kind: "task", id: 2 }), null);
  assert.equal(dropChange(tasks, 1, { kind: "task", id: 3 }), null);
  assert.equal(dropChange(tasks, 3, { kind: "task", id: 2 }), null);
  assert.equal(dropChange(tasks, 99, { kind: "task", id: 1 }), null);
});

test("グループ見出し・先頭の帯に落とすと、そのグループの最上位になる", () => {
  assert.deepEqual(dropChange(tasks, 3, { kind: "group", groupId: 8, name: "バイト" }), { parent_id: null, group_id: 8 });
  assert.deepEqual(dropChange(tasks, 2, { kind: "root", groupId: 7, name: "授業" }), { parent_id: null, group_id: 7 });
  assert.deepEqual(dropChange(tasks, 1, { kind: "group", groupId: null, name: "未分類" }), { parent_id: null, group_id: null });
  // すでにそのグループの最上位なら変化なし
  assert.equal(dropChange(tasks, 4, { kind: "group", groupId: null, name: "未分類" }), null);
  assert.equal(dropChange(tasks, 1, { kind: "root", groupId: 7, name: null }), null);
});

test("落とし先の説明", () => {
  assert.equal(dropLabel(tasks, { kind: "task", id: 2 }), "「タスク2」の下へ");
  assert.equal(dropLabel(tasks, { kind: "group", groupId: 7, name: "授業" }), "最上位へ（授業）");
  assert.equal(dropLabel(tasks, { kind: "root", groupId: null, name: null }), "最上位へ");
});
