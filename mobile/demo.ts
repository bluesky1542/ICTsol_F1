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
    case "/condition": return { level: "normal", updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
    case "/config": return { ai_configured: false };
    case "/calendar": return { sync: null, events: [] };
    default: throw new Error("デモではこの操作は利用できません。");
  }
}
