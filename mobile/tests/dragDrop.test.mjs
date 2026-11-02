import assert from "node:assert/strict";
import test from "node:test";
import { canDrop, dropLabel, findDropArea, groupByName } from "../dragDrop.ts";

const task = (id, group_id = null) => ({ id, group_id, title: `タスク${id}`, minutes: 10,
  deadline: null, priority: "medium", concentration: "medium", place: "", completed: false });
const tasks = [task(1, 7), task(2)];

test("指の位置にある落とし先を選び、重なるときは内側を優先する", () => {
  const areas = [
    { key: "group:7", target: { groupId: 7, name: "授業" }, top: 0, height: 300 },
    { key: "group:8", target: { groupId: 8, name: "バイト" }, top: 40, height: 60 },
  ];
  assert.equal(findDropArea(areas, 50).key, "group:8");
  assert.equal(findDropArea(areas, 10).key, "group:7");
  assert.equal(findDropArea(areas, 300), null);
  assert.equal(findDropArea([], 10), null);
});

test("別のグループ・未分類には移せ、今のグループには移せない", () => {
  assert.equal(canDrop(tasks, 1, { groupId: 8, name: "バイト" }), true);
  assert.equal(canDrop(tasks, 1, { groupId: null, name: "未分類" }), true);
  assert.equal(canDrop(tasks, 2, { groupId: 7, name: "授業" }), true);
  assert.equal(canDrop(tasks, 1, { groupId: 7, name: "授業" }), false);
  assert.equal(canDrop(tasks, 2, { groupId: null, name: "未分類" }), false);
  assert.equal(canDrop(tasks, 99, { groupId: 7, name: "授業" }), false);
});

test("落とし先の説明と、名前でのグループ検索", () => {
  assert.equal(dropLabel({ groupId: 7, name: "授業" }), "「授業」へ移す");
  const groups = [{ id: 7, name: "授業" }, { id: 8, name: "バイト" }];
  assert.equal(groupByName(groups, " 授業 ").id, 7);
  assert.equal(groupByName(groups, "授"), null);
  assert.equal(groupByName(groups, ""), null);
});
