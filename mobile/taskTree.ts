import type { Task } from "./api";

export type TaskRow = { task: Task; depth: number; childCount: number; doneChildCount: number };

function childrenByParent(tasks: readonly Task[]) {
  const children = new Map<number, Task[]>();
  for (const task of tasks) {
    if (task.parent_id === null) continue;
    const siblings = children.get(task.parent_id) ?? [];
    siblings.push(task); children.set(task.parent_id, siblings);
  }
  return children;
}

export function buildTree(tasks: readonly Task[], compare: (first: Task, second: Task) => number): TaskRow[] {
  const children = childrenByParent(tasks);
  for (const siblings of children.values()) siblings.sort(compare);
  const sorted = [...tasks].sort(compare), ids = new Set(tasks.map(task => task.id));
  const roots = sorted.filter(task => task.parent_id === null || !ids.has(task.parent_id));
  const visited = new Set<number>(), rows: TaskRow[] = [];
  for (const root of [...roots, ...sorted]) {
    if (visited.has(root.id)) continue;
    const stack = [{ task: root, depth: 0 }];
    while (stack.length) {
      const { task, depth } = stack.pop()!;
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      const descendants = children.get(task.id) ?? [];
      rows.push({ task, depth, childCount: descendants.length,
        doneChildCount: descendants.filter(child => child.completed).length });
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ task: descendants[index], depth: depth + 1 });
      }
    }
  }
  return rows;
}

export function descendantIds(tasks: readonly Task[], id: number): Set<number> {
  const children = childrenByParent(tasks), visited = new Set([id]), result = new Set<number>();
  const stack = [...(children.get(id) ?? [])].reverse();
  while (stack.length) {
    const task = stack.pop()!;
    if (visited.has(task.id)) continue;
    visited.add(task.id); result.add(task.id);
    const descendants = children.get(task.id) ?? [];
    for (let index = descendants.length - 1; index >= 0; index--) stack.push(descendants[index]);
  }
  return result;
}

export function descendantSummary(tasks: readonly Task[], id: number) {
  const descendants = descendantIds(tasks, id), parents = new Set(tasks.map(task => task.parent_id));
  let minutes = 0, deadline: string | null = null;
  const key = (value: string) => value.length === 10 ? `${value}T24:00` : value;
  for (const task of tasks) {
    if (!descendants.has(task.id) || task.completed) continue;
    if (!parents.has(task.id)) minutes += task.minutes;
    if (task.deadline && (deadline === null || key(task.deadline) < key(deadline))) deadline = task.deadline;
  }
  return { minutes, deadline };
}
