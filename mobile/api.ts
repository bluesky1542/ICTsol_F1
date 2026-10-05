import { Platform } from "react-native";

export type Level = "low" | "medium" | "high";
export type ConditionLevel = "good" | "normal" | "tired";
export type Task = {
  id: number; title: string; minutes: number; deadline: string | null;
  priority: Level; concentration: Level; place: string; completed: boolean;
};
export type Condition = { level: ConditionLevel; updated_at: string };
export type Suggestions = {
  source: "ai" | "no_candidates";
  choices: { task: Task; reason: string }[];
  rest_reason: string;
};

const base = (process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Platform.OS === "web" ? "http://localhost:8000" : "")).replace(/\/+$/, "");

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!base) throw new Error("mobile/.env に接続先を設定してください。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      method, signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "入力内容を確認してください。");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("通信がタイムアウトしました。もう一度試してください。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
