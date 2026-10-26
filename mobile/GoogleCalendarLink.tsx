import { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "./ui";

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
        padding: 12, textAlign: "center", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
      Googleカレンダーを開く ↗
    </a> : <Button title="Googleカレンダーを開く" onPress={() => void openCalendar()} />}
    <Text style={s.description}>開くだけでは取り込まれません。確認した予定は上で追加してください。</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}

const s = StyleSheet.create({
  panel: { gap: 10 },
  description: { color: "#52645e", fontSize: 13, lineHeight: 21 },
  error: { color: "#9a2920", fontSize: 13, lineHeight: 21 },
});
