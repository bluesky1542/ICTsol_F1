import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Platform.OS === "web" ? "http://localhost:8000" : "")
).replace(/\/+$/, "");

export default function App() {
  const [message, setMessage] = useState("未接続");
  const [loading, setLoading] = useState(false);

  const checkBackend = async () => {
    if (loading) return;
    if (!API_BASE_URL) {
      setMessage("mobile/.env に EXPO_PUBLIC_API_BASE_URL を設定してください。");
      return;
    }
    setLoading(true);
    setMessage("接続中...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${API_BASE_URL}/api/hello`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data?.message !== "string") throw new Error("応答形式が不正です");
      setMessage(data.message);
    } catch {
      setMessage("接続できませんでした。APIの起動・接続先・ネットワークを確認してください。");
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>ICTsol F1</Text>
            <Text style={styles.title}>疲労度を考慮した</Text>
            <Text style={styles.title}>タスク管理アプリ</Text>
            <Text style={styles.description}>
              その日の状態に合わせて、取り組みやすいタスクを提案します。
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              style={styles.button}
              onPress={checkBackend}
            >
              <Text style={styles.buttonText}>
                {loading ? "接続中..." : "バックエンドに接続する"}
              </Text>
            </Pressable>
            <Text style={styles.result}>{message}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 28,
  },
  eyebrow: {
    color: "#2563eb",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 18,
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "700",
  },
  description: {
    color: "#475569",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 18,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    marginTop: 28,
    padding: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  result: {
    color: "#475569",
    fontSize: 14,
    marginTop: 16,
    textAlign: "center",
  },
});
