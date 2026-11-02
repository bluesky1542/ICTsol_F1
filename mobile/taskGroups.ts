import type { Task, TaskGroup } from "./api";

export type GroupFilter = "all" | number | null;
export type TaskSection = { id: number | null; name: string; tasks: Task[] };

export function filterTasks(tasks: readonly Task[], group: GroupFilter): Task[] {
  return tasks.filter(task => group === "all" || task.group_id === group);
}

export function groupSections(tasks: readonly Task[], groups: readonly TaskGroup[]): TaskSection[] {
  const sections = groups.map(group => ({ ...group, tasks: filterTasks(tasks, group.id) }));
  return [...sections, { id: null, name: "未分類", tasks: filterTasks(tasks, null) }];
}
