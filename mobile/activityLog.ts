import type { Activity } from "./api";

// 日本時間の日付（YYYY-MM-DD）と時刻（H:MM）。サーバーと同じく日本時間で1日を区切る。
const japan = (time: number) => new Date(time + 9 * 3600000).toISOString();
export const japanDay = (time: number) => japan(time).slice(0, 10);
const japanClock = (time: number) => { const text = japan(time).slice(11, 16); return text.startsWith("0") ? text.slice(1) : text; };

// 残り時間（または超過時間）を「12:05」「1:02:03」の形にする。
export function formatDuration(milliseconds: number) {
  const total = Math.floor(Math.abs(milliseconds) / 1000);
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const outcomeLabels = { done: "完了", partial: "途中まで", stopped: "中断" } as const;

// 振り返りパネルの「今日やったこと」。今日（日本時間）の記録を時刻の早い順に並べる。
export function todayLog(activities: readonly Activity[], now: number) {
  const today = japanDay(now);
  return activities
    .filter(entry => japanDay(Date.parse(entry.created_at)) === today)
    .sort((first, second) => Date.parse(first.created_at) - Date.parse(second.created_at) || first.id - second.id)
    .map(entry => {
      const rest = (entry.kind ?? (entry.task_id === null ? "rest" : "task")) === "rest";
      const name = rest ? `ひと休み${entry.planned_minutes ? ` ${entry.planned_minutes}分` : ""}` : entry.task_title ?? "（削除したタスク）";
      // 取り組みモード導入前の記録（予定時刻なし）は結果を出さない。
      const status = entry.outcome ? outcomeLabels[entry.outcome] : entry.ends_at ? "取り組み中" : null;
      return { id: entry.id, time: japanClock(Date.parse(entry.created_at)), text: status && !(rest && status === "完了") ? `${name}（${status}）` : name };
    });
}
