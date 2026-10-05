import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Activity, api, Condition, ConditionLevel, Level, Suggestions, Task } from "./api";
import CalendarPanel from "./CalendarPanel";
import { isDemo } from "./demo";

const levels: [Level, string][] = [["low", "低"], ["medium", "中"], ["high", "高"]];
const conditions: [ConditionLevel, string][] = [
  ["slightly_tired", "少し疲れてる"],
  ["tired", "疲れてる"],
  ["normal", "普通"],
  ["slightly_good", "少し元気"],
  ["good", "元気"],
];

function Button({ title, onPress, disabled = false, selected = false }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }}
    onPress={onPress} disabled={disabled} style={[s.button, selected && s.selected, disabled && s.disabled]}>
    <Text style={[s.buttonText, selected && s.selectedText]}>{title}</Text>
  </Pressable>;
}

function Input({ label, value, set, numeric = false, placeholder = "", disabled = false }: {
  label: string; value: string; set: (text: string) => void; numeric?: boolean; placeholder?: string; disabled?: boolean;
}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label}
    style={s.input} value={value} onChangeText={set} editable={!disabled} keyboardType={numeric ? "number-pad" : "default"}
    placeholder={placeholder} placeholderTextColor="#64748b" maxLength={numeric ? 4 : 120} /></View>;
}

export default function Dashboard({ username, logout }: { username: string; logout: () => Promise<void> }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [aiConfigured, setAIConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Level>("medium");
  const [concentration, setConcentration] = useState<Level>("medium");
  const [place, setPlace] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [available, setAvailable] = useState("30");
  const [currentPlace, setCurrentPlace] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [selected, setSelected] = useState<number | "rest" | null>(null);
  const [calendarLinked, setCalendarLinked] = useState(false);
  const [useCalendar, setUseCalendar] = useState(true);
  const [now, setNow] = useState(Date.now());
  const conditionFresh = !!condition && now < Date.parse(condition.expires_at);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (!conditionFresh) invalidate(); }, [conditionFresh]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) {
      setError(e instanceof Error ? e.message : "通信できませんでした。");
      scroll.current?.scrollTo({ y: 0, animated: true });
    }
    finally { lock.current = false; setBusy(false); }
  }
  function invalidate() { setSuggestions(null); setSelected(null); }
  async function refresh() {
    const [nextTasks, nextCondition, config, nextActivities] = await Promise.all([
      api<Task[]>("/tasks"), api<Condition | null>("/condition"), api<{ ai_configured: boolean }>("/config"),
      api<Activity[]>("/activities"),
    ]);
    setActivities(nextActivities);
    setTasks(nextTasks); setCondition(nextCondition); setAIConfigured(config.ai_configured); setConnected(true); invalidate();
  }
  useEffect(() => { void run(refresh); }, []);

  function resetForm() {
    setEditing(null); setTitle(""); setMinutes("20"); setDeadline("");
    setPriority("medium"); setConcentration("medium"); setPlace("");
  }
  function integer(value: string) {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1440) throw new Error("時間は1〜1440分の整数で入力してください。");
    return Number(value);
  }
  async function saveTask() {
    if (!title.trim()) throw new Error("タスク名を入力してください。");
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
        Number.isNaN(Date.parse(deadline)) || new Date(deadline).toISOString().slice(0, 10) !== deadline)) {
      throw new Error("締切は実在する日付を YYYY-MM-DD 形式で入力してください。");
    }
    const saved = await api<Task>(editing === null ? "/tasks" : `/tasks/${editing}`, editing === null ? "POST" : "PUT", {
      title: title.trim(), minutes: integer(minutes), deadline: deadline || null, priority, concentration, place: place.trim(),
    });
    setTasks(previous => editing === null ? [saved, ...previous] : previous.map(t => t.id === saved.id ? saved : t));
    resetForm(); invalidate(); setNotice("タスクを保存しました。");
  }
  const levelLabel = (value: Level) => levels.find(([key]) => key === value)?.[1];
  async function choose(taskId: number | null) {
    const saved = await api<Activity>("/activities", "POST", { task_id: taskId });
    setActivities(previous => [saved, ...previous].slice(0, 50));
    setSelected(taskId ?? "rest"); setNotice("選択を履歴に保存しました。");
  }

  return <SafeAreaProvider><SafeAreaView style={s.root}><StatusBar style="dark" />
    <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.eyebrow}>ICTsol F1 · 毎日を、自分のペースで</Text>
      <Text style={s.heading}>いま、できそうなこと。</Text>
      <Text style={s.muted}>調子と空き時間に合わせて、AIと次の一歩を選びましょう。</Text>
      {isDemo && <Text style={s.muted}>画面確認用デモ：タスクはサンプルです。データの保存・AIの実行は行いません。</Text>}
      <View style={s.row}><Button title={busy ? "処理中…" : "最新の状態に更新"} disabled={busy} onPress={() => void run(refresh)} />
        <Text style={s.muted}>{username} さん</Text>
        <Button title="ログアウト" disabled={busy} onPress={() => void run(logout)} /></View>
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}

      <View style={s.card}><Text style={s.section}>1. 今の調子</Text>
        <View style={s.row}>{conditions.map(([key, label]) => <Button key={key} title={label} disabled={busy || !connected}
          selected={conditionFresh && condition?.level === key} onPress={() => void run(async () => {
            const saved = await api<Condition>("/condition", "PUT", { level: key });
            setCondition(saved); setNow(Date.now()); invalidate(); setNotice("今の調子を保存しました。");
          })} />)}</View>
        <Text style={s.muted}>{condition ? `前回入力：${new Date(condition.updated_at).toLocaleString("ja-JP")}。今の状態に合わせて押し直せます。` : "いずれかを選ぶと保存されます。"}</Text>
        {condition && !conditionFresh && <Text style={s.error}>今日の調子を選び直してください。日本時間で日付が変わると再入力が必要です。</Text>}
      </View>

      <View style={s.card}><Text style={s.section}>2. {editing === null ? "タスクを登録" : "タスクを編集"}</Text>
        <Input label="タスク名" value={title} set={setTitle} placeholder="例：レポートの下書き" disabled={busy} />
        <Input label="所要時間（分）" value={minutes} set={setMinutes} numeric disabled={busy} />
        <Input label="締切（任意）" value={deadline} set={setDeadline} placeholder="2026-10-15" disabled={busy} />
        <Text style={s.label}>優先度</Text><View style={s.row}>{levels.map(([key, label]) => <Button key={key} title={label}
          selected={priority === key} disabled={busy} onPress={() => setPriority(key)} />)}</View>
        <Text style={s.label}>必要な集中度</Text><View style={s.row}>{levels.map(([key, label]) => <Button key={key} title={label}
          selected={concentration === key} disabled={busy} onPress={() => setConcentration(key)} />)}</View>
        <Input label="実行場所（空欄ならどこでも）" value={place} set={setPlace} placeholder="例：自宅" disabled={busy} />
        <View style={s.row}><Button title={editing === null ? "タスクを追加" : "変更を保存"} selected disabled={busy || !connected} onPress={() => void run(saveTask)} />
          {editing !== null && <Button title="編集をやめる" disabled={busy} onPress={resetForm} />}</View>
      </View>

      <CalendarPanel disabled={busy || !connected} run={run} changed={linked => { setCalendarLinked(linked); invalidate(); }} />
      <View style={s.card}><Text style={s.section}>3. AIに提案してもらう</Text>
        {calendarLinked && <><Button title={useCalendar ? "✓ 取り込んだ予定を考慮する" : "予定を考慮しない"} selected={useCalendar} disabled={busy}
          onPress={() => { setUseCalendar(!useCalendar); invalidate(); }} /><Text style={s.muted}>保存済み予定から次の予定までの時間を計算します。端末から取り込んだ予定は変更後や24時間経過後に再取り込みしてください。手入力の予定にこの制限はありません。</Text></>}
        <Input label="いま使える時間（分）" value={available} set={v => { setAvailable(v); invalidate(); }} numeric disabled={busy} />
        <Input label="いまいる場所" value={currentPlace} set={v => { setCurrentPlace(v); invalidate(); }} placeholder="例：自宅（タスクの場所と一致）" disabled={busy} />
        <Text style={s.muted}>候補タスクの内容・入力した調子・空き時間・場所をOpenAIへ送信します。提案の取得にはAPI利用料金が発生します。</Text>
        {!aiConfigured && <Text style={s.muted}>AI提案は準備中です。タスクや予定の保存は利用できます。</Text>}
        <Button title={busy ? "処理中…" : "AIの提案を取得"} selected disabled={busy || !connected || !conditionFresh || !aiConfigured}
          onPress={() => void run(async () => {
            invalidate();
            const result = await api<Suggestions>("/recommendations", "POST", { available_minutes: integer(available), place: currentPlace.trim(), use_calendar: calendarLinked && useCalendar });
            setSuggestions(result);
          })} />
        {suggestions && <View style={s.stack}><Text style={s.muted}>今回考慮した空き時間：{suggestions.available_minutes}分</Text><Text style={s.label}>{suggestions.source === "ai" ? "AIからの候補（どれか1つを選べます）" : "条件に合う候補がありません"}</Text>
          {suggestions.choices.map(({ task, reason }) => <View key={task.id} style={s.suggestion}>
            <Text style={s.taskTitle}>{task.title} · {task.minutes}分</Text><Text style={s.body}>{reason}</Text>
            <Button title={selected === task.id ? "選択中" : "これに取り組む"} selected={selected === task.id} disabled={busy || isDemo || selected === task.id} onPress={() => void run(() => choose(task.id))} />
          </View>)}
          <View style={s.suggestion}><Text style={s.taskTitle}>ひと休みする</Text><Text style={s.body}>{suggestions.rest_reason}</Text>
            <Button title={selected === "rest" ? "休息を選択中" : "休息を選ぶ"} selected={selected === "rest"} disabled={busy || isDemo || selected === "rest"} onPress={() => void run(() => choose(null))} /></View>
          <Text style={s.muted}>選択は履歴に保存されます。終わったタスクは下の一覧で「完了にする」を押してください。</Text>
        </View>}
      </View>

      <View style={s.card}><Text style={s.section}>タスク一覧 · 未完了 {tasks.filter(t => !t.completed).length}件</Text>
        {!tasks.length && <Text style={s.muted}>まだタスクがありません。まずは1つ登録してみましょう。</Text>}
        {[...tasks].sort((a, b) => Number(a.completed) - Number(b.completed)).map(task => <View key={task.id} style={s.task}>
          <Text style={[s.taskTitle, task.completed && s.done]}>{task.completed ? "✓ " : ""}{task.title}</Text>
          <Text style={s.muted}>{task.minutes}分 · 優先度 {levelLabel(task.priority)} · 集中度 {levelLabel(task.concentration)}</Text>
          <Text style={s.muted}>締切 {task.deadline || "なし"} · 場所 {task.place || "どこでも"}</Text>
          <View style={s.row}><Button title={task.completed ? "未完了に戻す" : "完了にする"} disabled={busy} onPress={() => void run(async () => {
            const saved = await api<Task>(`/tasks/${task.id}`, "PATCH", { completed: !task.completed });
            setTasks(previous => previous.map(t => t.id === saved.id ? saved : t)); invalidate();
          })} /><Button title="編集" disabled={busy} onPress={() => {
            setEditing(task.id); setTitle(task.title); setMinutes(String(task.minutes)); setDeadline(task.deadline || "");
            setPriority(task.priority); setConcentration(task.concentration); setPlace(task.place); setNotice("上の「タスクを編集」で変更できます。");
            scroll.current?.scrollTo({ y: 0, animated: true });
          }} /></View>
        </View>)}
      </View>
      <View style={s.card}><Text style={s.section}>取り組み・休息の履歴</Text>
        {!activities.length && <Text style={s.muted}>タスクや休息を選ぶと、ここに記録されます。</Text>}
        {activities.map(activity => <View key={activity.id} style={s.task}>
          <Text style={s.taskTitle}>{activity.task_title ?? "ひと休みする"}</Text>
          <Text style={s.muted}>{new Date(activity.created_at).toLocaleString("ja-JP")} · {conditions.find(([key]) => key === activity.condition_level)?.[1]}</Text>
        </View>)}
        {!!activities.length && <Text style={s.muted}>直近50件を表示しています。記録は選択の履歴で、実行・完了の確認ではありません。</Text>}
      </View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f1f5f4" },
  content: { padding: 20, gap: 18, width: "100%", maxWidth: 760, alignSelf: "center" },
  eyebrow: { fontSize: 13, color: "#356458", fontWeight: "700", marginTop: 16 },
  heading: { fontSize: 30, fontWeight: "700", color: "#183c32" },
  muted: { color: "#52645e", fontSize: 13, lineHeight: 21 },
  card: { backgroundColor: "white", padding: 20, borderRadius: 18, gap: 14 },
  section: { fontSize: 20, fontWeight: "700", color: "#183c32" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  field: { gap: 6 }, label: { fontSize: 14, fontWeight: "600", color: "#314c43" },
  input: { borderWidth: 1, borderColor: "#bdcec7", borderRadius: 9, padding: 12, fontSize: 16, color: "#183c32", backgroundColor: "#fafcfb" },
  button: { borderWidth: 1, borderColor: "#b9cec4", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center" },
  buttonText: { fontSize: 14, fontWeight: "600", color: "#234e3d" },
  selected: { backgroundColor: "#24654c", borderColor: "#24654c" }, selectedText: { color: "white" }, disabled: { opacity: 0.45 },
  error: { padding: 14, backgroundColor: "#fff0ed", color: "#9a2920", borderRadius: 10 },
  notice: { padding: 14, backgroundColor: "#deeee4", color: "#234e3d", borderRadius: 10 },
  task: { gap: 8, paddingVertical: 14, borderTopWidth: 1, borderColor: "#e5ece8" },
  taskTitle: { fontSize: 17, color: "#243e33", fontWeight: "600" }, done: { textDecorationLine: "line-through", color: "#738179" },
  body: { fontSize: 15, lineHeight: 24, color: "#344d43" },
  stack: { gap: 14 }, suggestion: { padding: 16, backgroundColor: "#eef6f1", borderRadius: 12, gap: 12 },
});
