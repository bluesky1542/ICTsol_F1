import { Platform } from "react-native";
import type { Task } from "./api";

export const isDemo = Platform.OS === "web" && (process.env.EXPO_PUBLIC_DEMO_MODE === "1"
  || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1"));

const tasks: Task[] = [
  { id: 1, title: "レポートの見出しを考える", minutes: 15, deadline: null, priority: "high", concentration: "medium", place: "", completed: false },
  { id: 2, title: "机の上を片づける", minutes: 10, deadline: null, priority: "low", concentration: "low", place: "自宅", completed: false },
  { id: 3, title: "チームの発表資料を確認する", minutes: 30, deadline: null, priority: "medium", concentration: "high", place: "", completed: false },
];

// 閲覧用データだけを返し、サーバーへの通信や保存は行わない。
export function demoResponse(path: string, method: string): unknown {
  if (method !== "GET") throw new Error("画面確認用のデモです。登録・変更はログインしてお試しください。");
  switch (path) {
    case "/tasks": return tasks;
    case "/activities": return [];
    case "/reflections": return [];
    case "/reflections/summary": {
      const end = new Date(Date.now() + 9 * 3600000);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 6);
      return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), answered_days: 0,
        achievement: { done: 0, partial: 0, not_done: 0 }, average_satisfaction: null };
    }
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
