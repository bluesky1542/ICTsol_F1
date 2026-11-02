import type { Task } from "./api";

// 締切を日本時間で判定し、日付のみなら翌日から期限切れにする。
export function deadlinePassed(deadline: string | null, now: number): boolean {
  if (!deadline) return false;
  const day = deadline.slice(0, 10), time = deadline.slice(11, 16);
  if (time) return now >= Date.parse(`${day}T${time}:00+09:00`);
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  return Date.parse(day) < Date.parse(today);
}

// 件数と達成状況を集計し、完了・未完了が混在するときの表示率を1〜99%に収める。
export function taskStats(tasks: Task[], now: number) {
  const total = tasks.length;
  const done = tasks.filter(task => task.completed).length;
  const overdue = tasks.filter(task => !task.completed && deadlinePassed(task.deadline, now)).length;
  const open = total - done;
  const rate = done === 0 ? 0 : open === 0 ? 100 : Math.min(99, Math.max(1, Math.round(done / total * 100)));
  return { total, done, open, overdue, rate };
}
