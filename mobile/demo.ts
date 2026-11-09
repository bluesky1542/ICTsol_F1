import { Platform } from "react-native";
import type { Task } from "./api";

export const isDemo = Platform.OS === "web" && (process.env.EXPO_PUBLIC_DEMO_MODE === "1"
  || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1"));

const tasks: Task[] = [
  { id: 1, group_id: 1, title: "レポートを仕上げる", minutes: 15, deadline: null, priority: "high", concentration: "medium", place: "", completed: false },
  { id: 2, group_id: null, title: "机の上を片づける", minutes: 10, deadline: null, priority: "low", concentration: "low", place: "自宅", completed: false },
  { id: 3, group_id: 2, title: "チームの発表資料を確認する", minutes: 30, deadline: null, priority: "medium", concentration: "high", place: "", completed: false },
  { id: 4, group_id: 1, title: "参考資料を集める", minutes: 5, deadline: null, priority: "medium", concentration: "low", place: "", completed: true },
  { id: 5, group_id: 1, title: "資料の共有を終える", minutes: 10, deadline: null, priority: "low", concentration: "low", place: "", completed: true },
  { id: 6, group_id: 1, title: "レポートの構成を考える", minutes: 15, deadline: null, priority: "high", concentration: "medium", place: "", completed: false },
  { id: 7, group_id: 1, title: "序論を書き出す", minutes: 5, deadline: null, priority: "medium", concentration: "low", place: "", completed: false },
  { id: 8, group_id: 1, title: "資料を共有フォルダにまとめる", minutes: 10, deadline: null, priority: "low", concentration: "low", place: "", completed: true },
  { id: 9, group_id: 1, title: "共有リンクをチームに送る", minutes: 5, deadline: null, priority: "medium", concentration: "low", place: "", completed: true },
];

// 閲覧用データだけを返し、サーバーへの通信や保存は行わない。
export function demoResponse(path: string, method: string): unknown {
  if (method !== "GET") throw new Error("画面確認用のデモです。登録・変更はログインしてお試しください。");
  switch (path) {
    case "/tasks": return tasks;
    case "/groups": return [{ id: 1, name: "授業" }, { id: 2, name: "バイト" }];
    case "/activities": {
      // 振り返りの「今日やったこと」を見せるためのサンプル（今日の日本時間）。
      const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const at = (time: string) => new Date(`${day}T${time}:00+09:00`).toISOString();
      const entry = (id: number, time: string, changes: object) => ({ id, task_id: null, task_title: null, condition_level: "normal",
        created_at: at(time), kind: "task", rank: 1, planned_minutes: 15, ends_at: at(time), outcome: "done", ended_at: at(time), ...changes });
      return [
        entry(3, "15:30", { task_id: 2, task_title: "机の上を片づける", outcome: "partial", rank: 2 }),
        entry(2, "13:00", { kind: "rest", rank: null, planned_minutes: 10 }),
        entry(1, "09:10", { task_id: 9, task_title: "共有リンクをチームに送る", planned_minutes: 5 }),
      ];
    }
    case "/activities/current": return null;
    case "/reflections": return [];
    case "/reflections/plan": return { day: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), end_time: "18:00" };
    case "/condition": return { level: "normal", updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
    case "/config": return { ai_configured: false };
    case "/calendar": {
      const today = new Date();
      const at = (offset: number, hour: number, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, hour, minute).toISOString();
      return { sync: { synced_at: new Date().toISOString(), window_start: at(0, 0), window_end: at(7, 0), source: "imported" },
        events: [
          { event_key: "demo:morning", starts_at: at(0, 9), ends_at: at(0, 10, 30) },
          { event_key: "demo:afternoon", starts_at: at(0, 14), ends_at: at(0, 15) },
          { event_key: "demo:tomorrow", starts_at: at(1, 11), ends_at: at(1, 12) },
          { event_key: "demo:overnight", starts_at: at(2, 22), ends_at: at(3, 1) },
          { event_key: "demo:all-day", starts_at: at(4, 0), ends_at: at(5, 0) },
        ] };
    }
    default: throw new Error("デモではこの操作は利用できません。");
  }
}
