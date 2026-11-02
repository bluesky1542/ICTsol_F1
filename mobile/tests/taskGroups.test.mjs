import assert from "node:assert/strict";
import test from "node:test";
import { filterTasks, groupSections } from "../taskGroups.ts";

const groups = Object.freeze([{ id: 2, name: "授業" }, { id: 1, name: "バイト" }, { id: 3, name: "生活" }].map(Object.freeze));
const tasks = Object.freeze([
  { id: 1, group_id: 1, completed: false },
  { id: 2, group_id: null, completed: true },
  { id: 3, group_id: 2, completed: false },
  { id: 4, group_id: 2, completed: true },
  { id: 5, group_id: 2, completed: false },
].map(Object.freeze));

test("グループの作成順を保ち、空のグループと最後の未分類も含める", () => {
  const sections = groupSections(tasks, groups);
  assert.deepEqual(sections.map(section => [section.id, section.name, section.tasks.map(task => task.id)]), [
    [2, "授業", [3, 4, 5]], [1, "バイト", [1]], [3, "生活", []], [null, "未分類", [2]],
  ]);
  assert.deepEqual(groups.map(group => group.id), [2, 1, 3]);
  assert.deepEqual(tasks.map(task => task.id), [1, 2, 3, 4, 5]);
});

test("すべて・各グループ・未分類で完了状態に関係なく絞り込める", () => {
  assert.deepEqual(filterTasks(tasks, "all"), tasks);
  assert.deepEqual(filterTasks(tasks, 2).map(task => task.id), [3, 4, 5]);
  assert.deepEqual(filterTasks(tasks, null).map(task => task.id), [2]);
  assert.deepEqual(filterTasks(tasks, 99), []);
});

test("空の入力とグループなしでも未分類を扱える", () => {
  assert.deepEqual(groupSections([], []), [{ id: null, name: "未分類", tasks: [] }]);
  assert.deepEqual(groupSections(filterTasks(tasks, null), [])[0].tasks.map(task => task.id), [2]);
  assert.deepEqual(groupSections([], groups).map(section => section.tasks.length), [0, 0, 0, 0]);
});
