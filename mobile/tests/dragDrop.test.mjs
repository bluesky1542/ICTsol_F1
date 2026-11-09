import assert from "node:assert/strict";
import test from "node:test";
import { draftGroupName, dropAction, dropLabel, findDropArea, groupByName } from "../dragDrop.ts";

const task = (id, group_id = null, completed = false) => ({ id, group_id, title: `タスク${id}`, minutes: 10,
  deadline: null, priority: "medium", concentration: "medium", place: "", completed });
const tasks = [task(1, 7), task(2), task(3), task(4, 7), task(5, 8), task(6, null, true)];
const groups = [{ id: 7, name: "授業" }, { id: 8, name: "バイト" }];
const group = (groupId, name) => ({ kind: "group", groupId, name });
const onto = taskId => ({ kind: "task", taskId });

test("指の位置にある落とし先を選び、重なるときは内側を優先する", () => {
  const areas = [
    { key: "group:7", target: group(7, "授業"), top: 0, height: 300 },
    { key: "task:4", target: onto(4), top: 40, height: 60 },
  ];
  assert.equal(findDropArea(areas, 50).key, "task:4");
  assert.equal(findDropArea(areas, 10).key, "group:7");
  assert.equal(findDropArea(areas, 300), null);
  assert.equal(findDropArea([], 10), null);
});

test("グループの見出しには、別のグループ・未分類なら移せ、今のグループには移せない", () => {
  assert.deepEqual(dropAction(tasks, groups, 1, group(8, "バイト")), { kind: "move", groupId: 8, name: "バイト" });
  assert.deepEqual(dropAction(tasks, groups, 1, group(null, "未分類")), { kind: "move", groupId: null, name: "未分類" });
  assert.equal(dropAction(tasks, groups, 1, group(7, "授業")), null);
  assert.equal(dropAction(tasks, groups, 2, group(null, "未分類")), null);
  assert.equal(dropAction(tasks, groups, 99, group(7, "授業")), null);
});

test("未分類のタスクに重ねると、2つで新しいグループを作る", () => {
  assert.deepEqual(dropAction(tasks, groups, 2, onto(3)), { kind: "create", partner: tasks[2] });
  // グループに入っているタスクを未分類のタスクに重ねても、新しいグループにする。
  assert.deepEqual(dropAction(tasks, groups, 1, onto(3)), { kind: "create", partner: tasks[2] });
});

test("グループに入っているタスクに重ねると、そのグループへ移す", () => {
  assert.deepEqual(dropAction(tasks, groups, 2, onto(1)), { kind: "move", groupId: 7, name: "授業" });
  assert.deepEqual(dropAction(tasks, groups, 5, onto(4)), { kind: "move", groupId: 7, name: "授業" });
});

test("自分自身・同じグループ・完了済み・見つからないタスクには重ねられない", () => {
  assert.equal(dropAction(tasks, groups, 2, onto(2)), null);
  assert.equal(dropAction(tasks, groups, 1, onto(4)), null);
  assert.equal(dropAction(tasks, groups, 2, onto(6)), null);
  assert.equal(dropAction(tasks, groups, 2, onto(99)), null);
  // 相手のグループがもう消えているときも何もしない。
  assert.equal(dropAction([task(1), task(2, 42)], groups, 1, onto(2)), null);
});

test("ドラッグ中の説明", () => {
  assert.equal(dropLabel({ kind: "move", groupId: 7, name: "授業" }), "「授業」へ移す");
  assert.equal(dropLabel({ kind: "create", partner: tasks[2] }), "「タスク3」と新しいグループにする");
});

test("仮のグループ名は、使われていない名前にする", () => {
  assert.equal(draftGroupName(groups), "新しいグループ");
  assert.equal(draftGroupName([...groups, { id: 9, name: "新しいグループ" }]), "新しいグループ 2");
  assert.equal(draftGroupName([{ id: 9, name: "新しいグループ" }, { id: 10, name: "新しいグループ 2" }]), "新しいグループ 3");
});

test("名前でのグループ検索", () => {
  assert.equal(groupByName(groups, " 授業 ").id, 7);
  assert.equal(groupByName(groups, "授"), null);
  assert.equal(groupByName(groups, ""), null);
});
