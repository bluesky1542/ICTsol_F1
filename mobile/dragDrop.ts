import type { Task, TaskGroup } from "./api";

// ドラッグで落とせる場所（グループの見出し）。groupId が null なら未分類。
export type DropTarget = { groupId: number | null; name: string };
// 画面上の位置（ウィンドウ基準の上端と高さ）を付けた落とし先。
export type DropArea = { key: string; target: DropTarget; top: number; height: number };

// 指（マウス）の高さ y にある落とし先を探す。重なる場合は高さの小さい（内側の）ものを優先する。
export function findDropArea(areas: readonly DropArea[], y: number): DropArea | null {
  return areas.filter(area => y >= area.top && y < area.top + area.height)
    .sort((first, second) => first.height - second.height)[0] ?? null;
}

// その落とし先に移せるか（タスクが見つからない・すでにそのグループなら移せない）。
export function canDrop(tasks: readonly Task[], draggedId: number, target: DropTarget) {
  const dragged = tasks.find(task => task.id === draggedId);
  return !!dragged && dragged.group_id !== target.groupId;
}

// ドラッグ中に表示する「どこへ移すか」の説明。
export const dropLabel = (target: DropTarget) => `「${target.name}」へ移す`;

// 入力した名前と同じグループを探す（前後の空白は無視する）。
export function groupByName(groups: readonly TaskGroup[], name: string) {
  const text = name.trim();
  return groups.find(group => group.name === text) ?? null;
}
