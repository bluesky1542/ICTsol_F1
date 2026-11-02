import type { Task } from "./api";

export function deadlinePassed(deadline: string | null, now: number): boolean {
  if (!deadline) return false;
  const day = deadline.slice(0, 10), time = deadline.slice(11, 16);
  if (time) return now >= Date.parse(`${day}T${time}:00+09:00`);
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  return Date.parse(day) < Date.parse(today);
}

export function taskStats(tasks: Task[], now: number) {
  const total = tasks.length;
  const done = tasks.filter(task => task.completed).length;
  const overdue = tasks.filter(task => !task.completed && deadlinePassed(task.deadline, now)).length;
  return { total, done, open: total - done, overdue, rate: total ? Math.round(done / total * 100) : 0 };
}
