import { useState } from "react";
import { Button, Linking, Platform, StyleSheet, Text, View } from "react-native";

const googleCalendarUrl = "https://calendar.google.com/calendar/u/0/r";

export default function GoogleCalendarLink() {
  const [error, setError] = useState("");
  async function openCalendar() {
    setError("");
    try { await Linking.openURL(googleCalendarUrl); }
    catch { setError("Googleカレンダーを開けませんでした。ブラウザから calendar.google.com を開いてください。"); }
  }

  return <View style={s.panel}>
    {Platform.OS === "web" ? <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer"
      style={{ color: "#234e3d", backgroundColor: "#eef6f1", border: "1px solid #b9cec4", borderRadius: 10,
        padding: 12, textAlign: "center", fontSize: 14, fontWeight: 600, textDecoration: "underline" }}>
      Googleカレンダーを開く（別タブ）
    </a> : <Button title="Googleカレンダーを開く" onPress={() => void openCalendar()} />}
    <Text style={s.description}>{Platform.OS === "web" ? "別タブ" : "ブラウザまたは対応アプリ"}でGoogleカレンダーを表示します。Googleへのログインが必要な場合があります。複数のアカウントがある場合は、開いた先で切り替えてください。</Text>
    <Text style={s.description}>予定を確認したら、この画面に戻って予定時間を{Platform.OS === "web" ? "手入力" : "取り込むか手入力"}してください。開くだけでは自動で取り込まれません。</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}

const s = StyleSheet.create({
  panel: { gap: 10 },
  description: { color: "#52645e", fontSize: 13, lineHeight: 21 },
  error: { color: "#9a2920", fontSize: 13, lineHeight: 21 },
});
