import type { Task } from "./api";

// ドラッグで落とせる場所。task はそのタスクの子へ、group と root はそのグループの最上位へ移す。
export type DropTarget =
  | { kind: "task"; id: number }
  | { kind: "group"; groupId: number | null; name: string }
  | { kind: "root"; groupId: number | null; name: string | null };
// 画面上の位置（ウィンドウ基準の上端と高さ）を付けた落とし先。
export type DropArea = { key: string; target: DropTarget; top: number; height: number };

// target が dragged の子孫か（親をたどって確かめる。循環データでも止まる）。
function isInside(tasks: readonly Task[], draggedId: number, targetId: number) {
  const parents = new Map(tasks.map(task => [task.id, task.parent_id]));
  const seen = new Set<number>();
  for (let current = parents.get(targetId) ?? null; current !== null && !seen.has(current); current = parents.get(current) ?? null) {
    if (current === draggedId) return true;
    seen.add(current);
  }
  return false;
}

// 指（マウス）の高さ y にある落とし先を探す。重なる場合は高さの小さい（内側の）ものを優先する。
export function findDropArea(areas: readonly DropArea[], y: number): DropArea | null {
  return areas.filter(area => y >= area.top && y < area.top + area.height)
    .sort((first, second) => first.height - second.height)[0] ?? null;
}

// その落とし先に移すと親・グループがどう変わるか。変化がない・移せない場合は null。
export function dropChange(tasks: readonly Task[], draggedId: number, target: DropTarget):
  { parent_id: number | null; group_id: number | null } | null {
  const dragged = tasks.find(task => task.id === draggedId);
  if (!dragged) return null;
  if (target.kind === "task") {
    // 自分自身・自分の子孫の下には入れられない。今の親の上では何も変わらない。
    if (target.id === draggedId || target.id === dragged.parent_id || isInside(tasks, draggedId, target.id)) return null;
    const parent = tasks.find(task => task.id === target.id);
    return parent ? { parent_id: parent.id, group_id: parent.group_id } : null;
  }
  if (dragged.parent_id === null && dragged.group_id === target.groupId) return null;
  return { parent_id: null, group_id: target.groupId };
}

// ドラッグ中に表示する「どこへ移すか」の説明。
export function dropLabel(tasks: readonly Task[], target: DropTarget) {
  if (target.kind === "task") return `「${tasks.find(task => task.id === target.id)?.title ?? "タスク"}」の下へ`;
  return target.name ? `最上位へ（${target.name}）` : "最上位へ";
}
