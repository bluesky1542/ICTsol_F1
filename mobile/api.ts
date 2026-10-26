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
export type Achievement = "done" | "partial" | "not_done";
export type Reflection = {
  day: string; achievement: Achievement; satisfaction: number;
  tiredness: ConditionLevel; comment: string; updated_at: string;
};
export type WorkPlan = { day: string; end_time: string };
export type ReflectionSummary = {
  from: string; to: string; answered_days: number;
  achievement: Record<Achievement, number>; average_satisfaction: number | null;
};
export type Suggestions = {
  available_minutes: number;
  source: "ai" | "no_candidates";
  choices: { task: Task; reason: string }[];
  rest_reason: string;
};

const base = (process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Platform.OS === "web" ? "http://localhost:8000" : "")).replace(/\/+$/, "");

// JSONとして読めなかった応答の目印（null は正常な応答として返ることがあるため区別する）。
const UNREADABLE = Symbol("unreadable");

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
    // サーバーの起動中などはJSON以外（HTMLのエラーページ）が返るため、読めなくても落ちないようにする。
    const data = await response.json().catch(() => UNREADABLE);
    if (response.status === 401 && requestToken && requestToken === token) {
      token = null; expired?.();
    }
    if (!response.ok) {
      if (data !== UNREADABLE && typeof data?.detail === "string") throw new Error(data.detail);
      throw new Error(response.status >= 500 ? "サーバーが応答していません。少し待ってから↻で再読み込みしてください。" : "入力内容を確認してください。");
    }
    if (data === UNREADABLE) throw new Error("サーバーの応答を読み取れませんでした。↻で再読み込みしてください。");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("通信がタイムアウトしました。もう一度試してください。");
    // オフラインや接続先に届かないときは英語のメッセージになるため、日本語に置き換える。
    if (error instanceof TypeError) throw new Error("サーバーに接続できませんでした。通信環境を確認してください。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
