import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Dashboard from "./Dashboard";
import { api, onExpired, setSession } from "./api";

export default function Login() {
  const [user, setUser] = useState<{ id: number; username: string } | null>(null);
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onExpired(() => { setUser(null); setPassword(""); setConfirm(""); setError("ログインの有効期限が切れました。再ログインしてください。"); });
    return () => onExpired(null);
  }, []);
  async function submit() {
    if (busy) return;
    setError("");
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(username.trim()) || password.length < 12 || password.length > 128) {
      setError("ユーザー名は英数字・_・- の3〜40文字、パスワードは12〜128文字です。"); return;
    }
    if (register && password !== confirm) { setError("確認用パスワードが一致しません。"); return; }
    setBusy(true);
    try {
      const result = await api<{ token: string; user: { id: number; username: string } }>(`/auth/${register ? "register" : "login"}`, "POST", { username: username.trim(), password });
      setSession(result.token); setPassword(""); setConfirm(""); setUser(result.user);
    } catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした。"); }
    finally { setBusy(false); }
  }
  async function logout() {
    await api("/auth/logout", "POST");
    setSession(null); setUser(null); setPassword(""); setConfirm(""); setError("");
  }
  if (user) return <Dashboard key={user.id} username={user.username} logout={logout} />;
  return <SafeAreaProvider><SafeAreaView style={s.root}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.card}><Text style={s.heading}>{register ? "アカウント作成" : "おかえりなさい"}</Text>
      <Text>自分のタスクと予定を管理しましょう。</Text>
      <Text>ユーザー名（英数字・_・-、3〜40文字）</Text>
      <TextInput accessibilityLabel="ユーザー名" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} editable={!busy} maxLength={40} style={s.input} />
      <Text>パスワード（12〜128文字）</Text>
      <TextInput accessibilityLabel="パスワード" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" editable={!busy} maxLength={128} style={s.input} />
      {register && <><Text>パスワード（確認）</Text><TextInput accessibilityLabel="パスワード（確認）" value={confirm} onChangeText={setConfirm} secureTextEntry editable={!busy} maxLength={128} style={s.input} /></>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Button title={busy ? "処理中…" : register ? "登録して始める" : "ログイン"} disabled={busy} onPress={() => void submit()} />
      <Button title={register ? "ログインに戻る" : "新しいアカウントを作る"} disabled={busy} onPress={() => { setRegister(!register); setError(""); setPassword(""); setConfirm(""); }} />
      <Text>画面更新・アプリ終了後は再ログインが必要です。開発中のHTTP接続ではテスト用パスワードを使用してください。</Text>
    </View>
  </ScrollView></SafeAreaView></SafeAreaProvider>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: "#f1f5f4" }, content: { flexGrow: 1, justifyContent: "center", padding: 24 }, card: { width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: "white", padding: 24, borderRadius: 16, gap: 16 }, heading: { fontSize: 28, fontWeight: "700", color: "#183c32" }, input: { borderWidth: 1, borderColor: "#bdcec7", borderRadius: 8, padding: 12, fontSize: 16 }, error: { color: "#9a2920" } });
