import type { Task, TaskGroup } from "./api";

// 移し先のグループ。groupId が null なら未分類。
export type GroupRef = { groupId: number | null; name: string };
// ドラッグで落とせる場所。グループの見出しか、ほかのタスクの行。
export type DropTarget = ({ kind: "group" } & GroupRef) | { kind: "task"; taskId: number };
// 画面上の位置（ウィンドウ基準の上端と高さ）を付けた落とし先。
export type DropArea = { key: string; target: DropTarget; top: number; height: number };
// 落としたときにすること。グループへ移すか、相手のタスクと新しいグループを作るか。
export type DropAction = ({ kind: "move" } & GroupRef) | { kind: "create"; partner: Task };

// 指（マウス）の高さ y にある落とし先を探す。重なる場合は高さの小さい（内側の）ものを優先する。
export function findDropArea(areas: readonly DropArea[], y: number): DropArea | null {
  return areas.filter(area => y >= area.top && y < area.top + area.height)
    .sort((first, second) => first.height - second.height)[0] ?? null;
}

// 落としたときにすることを決める。できない場合は null。
// タスクの上に落とすと、相手がグループに入っていればそのグループへ移し、
// 相手が未分類なら2つで新しいグループを作る（名前はこのあと付けてもらう）。
export function dropAction(tasks: readonly Task[], groups: readonly TaskGroup[], draggedId: number, target: DropTarget): DropAction | null {
  const dragged = tasks.find(task => task.id === draggedId);
  if (!dragged) return null;
  if (target.kind === "group") {
    return dragged.group_id === target.groupId ? null : { kind: "move", groupId: target.groupId, name: target.name };
  }
  const partner = tasks.find(task => task.id === target.taskId);
  if (!partner || partner.id === dragged.id || partner.completed) return null;
  if (partner.group_id === null) return { kind: "create", partner };
  const group = groups.find(value => value.id === partner.group_id);
  if (!group || group.id === dragged.group_id) return null;
  return { kind: "move", groupId: group.id, name: group.name };
}

// ドラッグ中に表示する「どうなるか」の説明。
export const dropLabel = (action: DropAction) => action.kind === "move"
  ? `「${action.name}」へ移す`
  : `「${action.partner.title}」と新しいグループにする`;

// タスクを重ねて作るグループの仮の名前。同じ名前があれば「新しいグループ 2」のように番号を付ける。
export function draftGroupName(groups: readonly TaskGroup[]) {
  const names = new Set(groups.map(group => group.name));
  const base = "新しいグループ";
  if (!names.has(base)) return base;
  let number = 2;
  while (names.has(`${base} ${number}`)) number += 1;
  return `${base} ${number}`;
}

// 入力した名前と同じグループを探す（前後の空白は無視する）。
export function groupByName(groups: readonly TaskGroup[], name: string) {
  const text = name.trim();
  return groups.find(group => group.name === text) ?? null;
}
