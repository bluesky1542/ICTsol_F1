import { Platform } from "react-native";

// ブラウザの通知機能。アプリ版や非対応ブラウザでは何もしない（画面内の表示だけになる）。
const supported = () => Platform.OS === "web" && typeof window !== "undefined" && "Notification" in window;

// ボタンを押した直後に呼び、通知の許可を求める。
export function askNotificationPermission() {
  if (supported() && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
}

// 指定時刻に1回だけ通知する。画面（タブ）が開いている間だけ有効。戻り値で取り消せる。
export function scheduleNotification(at: number, title: string, body: string, onClick: () => void) {
  const delay = at - Date.now();
  if (!supported() || delay <= 0 || delay > 2 ** 31 - 1) return () => undefined;
  const timer = setTimeout(() => {
    if (Notification.permission !== "granted") return;
    try {
      const notice = new Notification(title, { body, tag: "ictsol-reflection" });
      notice.onclick = () => { window.focus(); onClick(); notice.close(); };
    } catch { /* スマホのブラウザなど new Notification が使えない環境では画面内の表示に任せる */ }
  }, delay);
  return () => clearTimeout(timer);
}
