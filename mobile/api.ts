import { Platform } from "react-native";
import { demoResponse, isDemo } from "./demo";

export type Level = "low" | "medium" | "high";
export type ConditionLevel = "good" | "slightly_good" | "normal" | "slightly_tired" | "tired";
export type Task = {
  id: number; title: string; minutes: number; deadline: string | null;
  priority: Level; concentration: Level; place: string; completed: boolean;
};
export type Condition = { level: ConditionLevel; updated_at: string; expires_at: string };
export type Activity = {
  id: number; task_id: number | null; task_title: string | null;
  condition_level: ConditionLevel; created_at: string;
};
export type Suggestions = {
  available_minutes: number;
  source: "ai" | "no_candidates";
  choices: { task: Task; reason: string }[];
  rest_reason: string;
};

const base = (process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Platform.OS === "web" ? "http://localhost:8000" : "")).replace(/\/+$/, "");

// トークンはメモリにのみ保持し、更新・終了時は再ログインする。
let token: string | null = null;
let expired: (() => void) | null = null;
export function setSession(value: string | null) { token = value; }
export function onExpired(callback: (() => void) | null) { expired = callback; }

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (isDemo) return demoResponse(path, method) as T;
  if (!base && Platform.OS !== "web") throw new Error("mobile/.env に接続先を設定してください。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  const requestToken = token;
  try {
    const response = await fetch(`${base}/api${path}`, {
      method, signal: controller.signal,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 401 && requestToken && requestToken === token) {
      token = null; expired?.();
    }
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "入力内容を確認してください。");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("通信がタイムアウトしました。もう一度試してください。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
