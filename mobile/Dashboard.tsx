import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Achievement, Activity, api, Condition, ConditionLevel, Level, Reflection, ReflectionSummary, Suggestions, Task, WorkPlan } from "./api";
import CalendarPanel from "./CalendarPanel";
import { isDemo } from "./demo";
import { askNotificationPermission, scheduleNotification } from "./notify";
import { Button, Card, colors, Details, Hint, Input, Label, Row, Stars, Tabs, s as ui } from "./ui";

type Tab = "now" | "tasks" | "calendar";
const levels: [Level, string][] = [["low", "低"], ["medium", "中"], ["high", "高"]];
const conditions: [ConditionLevel, string][] = [
  ["slightly_tired", "少し疲れてる"],
  ["tired", "疲れてる"],
  ["normal", "普通"],
  ["slightly_good", "少し元気"],
  ["good", "元気"],
];
const achievements: [Achievement, string][] = [["done", "できた"], ["partial", "途中まで"], ["not_done", "できなかった"]];
const availablePresets = ["15", "30", "60", "90"];
const minutePresets = ["15", "30", "60"];
const endPresets = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
// 「1830」「9:00」なども HH:MM にそろえる。正しくなければ null。
function normalizeTime(text: string) {
  const match = text.trim().replace("：", ":").match(/^(\d{1,2}):?(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
// 振り返りは終了予定の30分前から出す。
const REFLECTION_LEAD = 30 * 60000;
const clock = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(11, 16);
// サーバーと同じく日本時間の日付で「今日」を判定する。
const japanToday = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 10);
const shortDate = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

export default function Dashboard({ username, logout }: { username: string; logout: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("now");
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
  const [showDetails, setShowDetails] = useState(false);
  const [available, setAvailable] = useState("30");
  const [customAvailable, setCustomAvailable] = useState(false);
  const [currentPlace, setCurrentPlace] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [selected, setSelected] = useState<number | "rest" | null>(null);
  const [calendarLinked, setCalendarLinked] = useState(false);
  const [calendarReload, setCalendarReload] = useState(0);
  const [useCalendar, setUseCalendar] = useState(true);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [reflectionSummary, setReflectionSummary] = useState<ReflectionSummary | null>(null);
  const [achievement, setAchievement] = useState<Achievement | null>(null);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [tiredness, setTiredness] = useState<ConditionLevel | null>(null);
  const [comment, setComment] = useState("");
  const [workEnd, setWorkEnd] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState(false);
  const [endDraft, setEndDraft] = useState("");
  const [reflectionOpen, setReflectionOpen] = useState(false);
  // 「あとで」を押したら、この時刻まで横からのパネルを出さない。
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const panelWidth = Math.min(400, screenWidth - 24);
  const [now, setNow] = useState(Date.now());
  const reflectionDay = japanToday(now);
  const todayReflection = reflections.find(r => r.day === reflectionDay);
  const conditionFresh = !!condition && now < Date.parse(condition.expires_at);
  // 終了予定は日本時間の今日の時刻として扱う。
  const dueAt = workEnd ? Date.parse(`${reflectionDay}T${workEnd}:00+09:00`) - REFLECTION_LEAD : null;
  const reflectionDue = dueAt !== null && now >= dueAt && !todayReflection;
  const showReflection = (reflectionDue && now >= snoozeUntil) || reflectionOpen;
  // 画面の右端から振り返りパネルをすべり込ませる。
  useEffect(() => {
    Animated.timing(slide, { toValue: showReflection ? 1 : 0, duration: 280, useNativeDriver: Platform.OS !== "web" }).start();
  }, [showReflection]);
  function laterReflection() { setReflectionOpen(false); if (reflectionDue) setSnoozeUntil(Date.now() + 15 * 60000); }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (!conditionFresh) invalidate(); }, [conditionFresh]);
  useEffect(() => {
    if (dueAt === null || todayReflection) return;
    return scheduleNotification(dueAt, "今日の振り返りの時間です", "おつかれさまでした。3つの質問に答えて1日を締めくくりましょう。",
      () => { setNow(Date.now()); changeTab("now"); });
  }, [dueAt, !!todayReflection]);
  useEffect(() => {
    setAchievement(todayReflection?.achievement ?? null); setSatisfaction(todayReflection?.satisfaction ?? null);
    setTiredness(todayReflection?.tiredness ?? null); setComment(todayReflection?.comment ?? "");
  }, [reflectionDay, todayReflection]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) {
      setError(e instanceof Error ? e.message : "通信できませんでした。");
    }
    finally { lock.current = false; setBusy(false); }
  }
  function invalidate() { setSuggestions(null); setSelected(null); }
  async function refresh() {
    const [nextTasks, nextCondition, config, nextActivities, nextReflections, nextSummary, plan] = await Promise.all([
      api<Task[]>("/tasks"), api<Condition | null>("/condition"), api<{ ai_configured: boolean }>("/config"),
      api<Activity[]>("/activities"), api<Reflection[]>("/reflections"),
      api<ReflectionSummary>("/reflections/summary"), api<WorkPlan | null>("/reflections/plan"),
    ]);
    setWorkEnd(plan?.end_time ?? null);
    setNow(Date.now()); setActivities(nextActivities); setReflections(nextReflections); setReflectionSummary(nextSummary);
    setTasks(nextTasks); setCondition(nextCondition); setAIConfigured(config.ai_configured); setConnected(true); invalidate();
  }
  useEffect(() => { void run(refresh); }, []);

  function changeTab(next: Tab) { setTab(next); scroll.current?.scrollTo({ y: 0, animated: false }); }
  function resetForm() {
    setEditing(null); setTitle(""); setMinutes("20"); setDeadline("");
    setPriority("medium"); setConcentration("medium"); setPlace(""); setShowDetails(false);
  }
  function startEdit(task: Task) {
    setEditing(task.id); setTitle(task.title); setMinutes(String(task.minutes)); setDeadline(task.deadline || "");
    setPriority(task.priority); setConcentration(task.concentration); setPlace(task.place); setShowDetails(true);
    scroll.current?.scrollTo({ y: 0, animated: true });
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
  async function toggleTask(task: Task) {
    const saved = await api<Task>(`/tasks/${task.id}`, "PATCH", { completed: !task.completed });
    setTasks(previous => previous.map(t => t.id === saved.id ? saved : t)); invalidate();
  }
  async function choose(taskId: number | null) {
    const saved = await api<Activity>("/activities", "POST", { task_id: taskId });
    setActivities(previous => [saved, ...previous].slice(0, 50));
    setSelected(taskId ?? "rest"); setNotice(taskId === null ? "休息を記録しました。ゆっくり休みましょう。" : "取り組むタスクを記録しました。");
  }
  async function saveReflection() {
    if (japanToday(Date.now()) !== reflectionDay) {
      setNow(Date.now());
      throw new Error("日付が変わりました。今日の振り返りを入力し直してください。");
    }
    if (!achievement || !satisfaction || !tiredness) throw new Error("振り返りの3つの質問すべてに答えてください。");
    const saved = await api<Reflection>("/reflections/today", "PUT", { achievement, satisfaction, tiredness, comment: comment.trim() });
    setReflections(previous => [saved, ...previous.filter(r => r.day !== saved.day)].slice(0, 14));
    setReflectionSummary(null); setReflectionOpen(false);
    setNotice("今日の振り返りを保存しました。おつかれさまでした。");
    try { setReflectionSummary(await api<ReflectionSummary>("/reflections/summary")); }
    catch { setNotice("今日の振り返りは保存済みです。まとめは↻で更新してください。"); }
  }
  const label = <T,>(options: [T, string][], value: T) => options.find(([key]) => key === value)?.[1];
  const open = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);
  const places = [...new Set(tasks.map(t => t.place.trim()).filter(Boolean))];
  const aiBlocked = !connected ? "サーバーに接続できていません。↻で再読み込みしてください。"
    : !aiConfigured ? "AI提案は準備中です。"
    : !conditionFresh ? "先に「今の調子」を選んでください。" : "";
  const setAvailableAndReset = (value: string) => { setAvailable(value); invalidate(); };
  function saveWorkEnd(text: string) {
    // 許可ダイアログはボタン操作の直後に出す必要があるため、通信より先に求める。
    askNotificationPermission();
    void run(async () => {
      const end = normalizeTime(text);
      if (!end) throw new Error("終了時刻は 18:30 のように入力してください。");
      const saved = await api<WorkPlan>("/reflections/plan", "PUT", { end_time: end });
      setWorkEnd(saved.end_time); setCustomEnd(false); setEndDraft(""); setNow(Date.now());
      const due = Date.parse(`${saved.day}T${saved.end_time}:00+09:00`) - REFLECTION_LEAD;
      setNotice(due <= Date.now() ? "終了予定が近いので、振り返りを出しました。" : `${clock(due)}ごろに振り返りをお知らせします。`);
    });
  }

  // 描画のたびに部品を作り直さないよう、関数として呼び出す。
  function taskRow(task: Task) {
    const meta = [`${task.minutes}分`, task.deadline && `締切 ${shortDate(task.deadline)}`, task.place].filter(Boolean).join(" · ");
    return <View key={task.id} style={s.taskRow}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.completed, disabled: busy }}
        accessibilityLabel={`${task.title}を${task.completed ? "未完了に戻す" : "完了にする"}`} disabled={busy}
        onPress={() => void run(() => toggleTask(task))} style={s.checkArea}>
        <View style={[s.check, task.completed && s.checkOn]}>{task.completed && <Text style={s.checkMark}>✓</Text>}</View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}を編集`} disabled={busy}
        onPress={() => startEdit(task)} style={s.taskBody}>
        <Text style={[s.taskTitle, task.completed && s.done]}>{task.title}</Text>
        <View style={s.metaRow}>
          <Text style={ui.hint}>{meta}</Text>
          {task.priority === "high" && <Text style={s.badge}>優先</Text>}
          {task.concentration === "high" && <Text style={s.badge}>集中</Text>}
        </View>
      </Pressable>
    </View>;
  }

  const hidden = (key: Tab) => tab !== key && s.hidden;

  return <SafeAreaProvider><SafeAreaView style={s.root}><StatusBar style="dark" />
    <View style={s.top}>
      <View style={s.header}>
        <Text style={s.appName}>ICTsol F1</Text>
        <Text numberOfLines={1} style={s.user}>{username}</Text>
        <Button small title={busy ? "…" : "↻"} label="最新の状態に更新" disabled={busy}
          onPress={() => void run(async () => { await refresh(); setCalendarReload(n => n + 1); })} />
        <Button small title="ログアウト" disabled={busy} onPress={() => void run(logout)} />
      </View>
      <Tabs tabs={[["now", "いま"], ["tasks", `タスク${open.length ? ` ${open.length}` : ""}`], ["calendar", "予定"]]}
        value={tab} set={changeTab} />
      {isDemo && <Hint>デモ画面です（保存・AIは動きません）</Hint>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
    </View>
    <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

      {/* いま：調子 → 時間 → 場所 → 提案 の順に上から操作する */}
      <View style={[s.stack, hidden("now")]}>
        <Card title="今の調子は？">
          <Row>{conditions.map(([key, text]) => <Button key={key} title={text} disabled={busy || !connected}
            selected={conditionFresh && condition?.level === key} onPress={() => void run(async () => {
              const saved = await api<Condition>("/condition", "PUT", { level: key });
              setCondition(saved); setNow(Date.now()); invalidate(); setNotice("今の調子を保存しました。");
            })} />)}</Row>
          {condition && !conditionFresh && <Hint warn>日付が変わりました。今日の調子を選んでください。</Hint>}
          <Label>今日は何時まで作業する？</Label>
          <Row>
            {endPresets.map(time => <Button key={time} small title={time} selected={!customEnd && workEnd === time}
              disabled={busy || !connected || isDemo} onPress={() => saveWorkEnd(time)} />)}
            <Button small title="その他" selected={customEnd || (!!workEnd && !endPresets.includes(workEnd))}
              disabled={busy || !connected || isDemo} onPress={() => { setCustomEnd(true); setEndDraft(workEnd ?? ""); }} />
          </Row>
          {customEnd && <Row>
            <View style={s.minutesInput}><Input label="終了時刻" hideLabel value={endDraft} set={setEndDraft} placeholder="18:30" maxLength={5} disabled={busy} /></View>
            <Button small primary title="決定" disabled={busy} onPress={() => saveWorkEnd(endDraft)} />
          </Row>}
          {dueAt !== null && !todayReflection && !reflectionDue && <Hint>🔔 {clock(dueAt)}ごろに振り返りをお知らせします</Hint>}
        </Card>

        <Card title="AIに次の一歩を提案してもらう">
          <Label>使える時間</Label>
          <Row>
            {availablePresets.map(value => <Button key={value} small title={`${value}分`} disabled={busy}
              selected={!customAvailable && available === value}
              onPress={() => { setCustomAvailable(false); setAvailableAndReset(value); }} />)}
            <Button small title="その他" disabled={busy} selected={customAvailable || !availablePresets.includes(available)}
              onPress={() => setCustomAvailable(true)} />
          </Row>
          {(customAvailable || !availablePresets.includes(available)) &&
            <Input label="使える時間（分）" hideLabel value={available} set={setAvailableAndReset} numeric placeholder="分" disabled={busy} />}
          {calendarLinked && <Row><Button small title={useCalendar ? "✓ 次の予定までに収める" : "予定を考慮しない"} selected={useCalendar} disabled={busy}
            onPress={() => { setUseCalendar(!useCalendar); invalidate(); }} /></Row>}

          <Label>いる場所</Label>
          {!!places.length && <Row>{places.map(p => <Button key={p} small title={p} disabled={busy}
            selected={currentPlace.trim() === p} onPress={() => { setCurrentPlace(currentPlace.trim() === p ? "" : p); invalidate(); }} />)}</Row>}
          <Input label="いる場所" hideLabel value={currentPlace} set={v => { setCurrentPlace(v); invalidate(); }} placeholder="例：自宅（空欄＝どこでも）" disabled={busy} />

          <Button primary title={busy ? "考え中…" : "提案してもらう"} disabled={busy || !!aiBlocked}
            onPress={() => void run(async () => {
              invalidate();
              const result = await api<Suggestions>("/recommendations", "POST", { available_minutes: integer(available), place: currentPlace.trim(), use_calendar: calendarLinked && useCalendar });
              setSuggestions(result);
            })} />
          {!!aiBlocked && <Hint>{aiBlocked}</Hint>}
          <Details title="送信先：Google（Gemini）">
            <Hint>候補タスク・今の調子・使える時間・場所と、過去7回分の朝の調子と振り返り（コメントを含む）を送信します。</Hint>
            <Hint>無料枠では送信内容がGoogleの製品改善に使われる場合があります。個人情報・機密情報は入力しないでください。</Hint>
          </Details>
        </Card>

        {suggestions && <Card title={suggestions.source === "ai" ? "どれか1つ選んでください" : "今できるタスクはありません"}
          right={<Hint>{suggestions.available_minutes}分</Hint>}>
          {suggestions.choices.map(({ task, reason }, index) => <View key={task.id} style={s.suggestion}>
            <Text style={s.taskTitle}>{index === 0 ? "おすすめ　" : ""}{task.title}　<Text style={ui.hint}>{task.minutes}分</Text></Text>
            <Text style={s.body}>{reason}</Text>
            <Button title={selected === task.id ? "✓ 取り組み中" : "これにする"} selected={selected === task.id}
              disabled={busy || isDemo || selected === task.id} onPress={() => void run(() => choose(task.id))} />
          </View>)}
          <View style={[s.suggestion, s.rest]}>
            <Text style={s.taskTitle}>ひと休みする</Text>
            <Text style={s.body}>{suggestions.rest_reason}</Text>
            <Button title={selected === "rest" ? "✓ 休憩中" : "休む"} selected={selected === "rest"}
              disabled={busy || isDemo || selected === "rest"} onPress={() => void run(() => choose(null))} />
          </View>
        </Card>}

        {/* 記録：今日の振り返りの入口と、これまでの記録（普段は閉じておく） */}
        <Card title="きょうの記録" right={todayReflection ? <Hint>振り返り済み ✓</Hint> : workEnd ? <Hint>{workEnd}まで</Hint> : undefined}>
          {!showReflection && <Row><Button small title={todayReflection ? "振り返りを答え直す" : "今すぐ振り返る"} disabled={busy || isDemo}
            onPress={() => setReflectionOpen(true)} /></Row>}
          <Details title="これまでの記録">
            {reflectionSummary && reflectionSummary.to === reflectionDay && !!reflectionSummary.answered_days && <>
              <Label>この7日間</Label>
              <View style={s.stats}>
                <Stat value={`${reflectionSummary.answered_days}/7`} text="回答" />
                <Stat value={String(reflectionSummary.achievement.done)} text="できた" />
                <Stat value={String(reflectionSummary.achievement.partial)} text="途中まで" />
                <Stat value={String(reflectionSummary.achievement.not_done)} text="できなかった" />
                <Stat value={`★${reflectionSummary.average_satisfaction?.toFixed(1)}`} text="満足度" />
              </View>
            </>}
            {!!reflections.length && <Label>振り返り</Label>}
            {reflections.slice(0, 7).map(r => <View key={r.day} style={s.listRow}>
              <Text style={s.taskTitle}>{shortDate(r.day)}　<Text style={ui.hint}>{label(achievements, r.achievement)} · ★{r.satisfaction} · {label(conditions, r.tiredness)}</Text></Text>
              {!!r.comment && <Text style={s.body}>{r.comment}</Text>}
            </View>)}
            <Label>取り組み・休息</Label>
            {!activities.length && <Hint>提案から選ぶと、ここに記録されます。</Hint>}
            {activities.map(activity => <View key={activity.id} style={s.listRow}>
              <Text style={s.taskTitle}>{activity.task_title ?? "ひと休み"}</Text>
              <Text style={ui.hint}>{new Date(activity.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {label(conditions, activity.condition_level)}</Text>
            </View>)}
          </Details>
        </Card>
      </View>

      {/* タスク：追加フォームと一覧 */}
      <View style={[s.stack, hidden("tasks")]}>
        <Card title={editing === null ? "タスクを追加" : "タスクを編集"}>
          <Input label="タスク名" hideLabel value={title} set={setTitle} placeholder="タスク名（例：レポートの下書き）" disabled={busy} />
          <Label>かかる時間</Label>
          <Row>
            {minutePresets.map(value => <Button key={value} small title={`${value}分`} selected={minutes === value} disabled={busy} onPress={() => setMinutes(value)} />)}
            <View style={s.minutesInput}><Input label="かかる時間（分）" hideLabel value={minutes} set={setMinutes} numeric placeholder="分" disabled={busy} /></View>
            <Text style={ui.hint}>分</Text>
          </Row>
          <Details title="詳細（締切・優先度・集中度・場所）" open={showDetails} onToggle={setShowDetails}>
            <Input label="締切" value={deadline} set={setDeadline} placeholder="2026-10-15" disabled={busy} />
            <Label>優先度</Label><Row>{levels.map(([key, text]) => <Button key={key} small title={text}
              selected={priority === key} disabled={busy} onPress={() => setPriority(key)} />)}</Row>
            <Label>必要な集中度</Label><Row>{levels.map(([key, text]) => <Button key={key} small title={text}
              selected={concentration === key} disabled={busy} onPress={() => setConcentration(key)} />)}</Row>
            <Input label="場所（空欄ならどこでも）" value={place} set={setPlace} placeholder="例：自宅" disabled={busy} />
          </Details>
          <Row><Button primary title={editing === null ? "追加" : "保存"} disabled={busy || !connected} onPress={() => void run(saveTask)} />
            {editing !== null && <Button title="やめる" disabled={busy} onPress={resetForm} />}</Row>
        </Card>

        <Card title={`やること ${open.length}件`}>
          {!tasks.length && <Hint>まだタスクがありません。上から追加しましょう。</Hint>}
          {open.map(taskRow)}
          {!!done.length && <Details title={`完了済み（${done.length}件）`}>
            {done.map(taskRow)}
          </Details>}
          {!!tasks.length && <Hint>□ で完了、タスク名で編集</Hint>}
        </Card>
      </View>

      {/* 予定：常に読み込んだままにし、連携状態を「いま」タブでも使う */}
      <View style={[s.stack, hidden("calendar")]}>
        <CalendarPanel disabled={busy || !connected} run={run} reload={calendarReload}
          changed={linked => { setCalendarLinked(linked); invalidate(); }} />
      </View>

    </ScrollView>
    {/* 振り返り：終了予定の30分前になると画面の横から出てくる */}
    <Animated.View pointerEvents={showReflection ? "auto" : "none"} accessibilityViewIsModal={showReflection}
      style={[s.panel, { width: panelWidth, maxHeight: screenHeight - 24, opacity: slide,
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [panelWidth + 24, 0] }) }] }]}>
      <ScrollView contentContainerStyle={s.panelContent} keyboardShouldPersistTaps="handled">
        <View style={ui.cardHeading}>
          <Text style={ui.section}>🌙 今日の振り返り</Text>
          <Button small title="あとで" disabled={busy} onPress={laterReflection} />
        </View>
        <Hint>おつかれさまでした。3つ答えたら1日の締めくくりです。</Hint>
        <Label>タスクはできた？</Label>
        <Row>{achievements.map(([key, text]) => <Button key={key} title={text} selected={achievement === key}
          disabled={busy || isDemo} onPress={() => setAchievement(key)} />)}</Row>
        <Label>AIの提案は役に立った？</Label>
        <Stars value={satisfaction} set={setSatisfaction} disabled={busy || isDemo} />
        <Label>今の疲れ具合は？</Label>
        <Row>{conditions.map(([key, text]) => <Button key={key} small title={text} selected={tiredness === key}
          disabled={busy || isDemo} onPress={() => setTiredness(key)} />)}</Row>
        <TextInput accessibilityLabel="ひとこと" style={ui.input} value={comment} onChangeText={setComment} editable={!busy && !isDemo}
          placeholder="ひとこと（任意）" placeholderTextColor="#64748b" maxLength={200} multiline />
        <Button primary title={todayReflection ? "更新する" : "保存する"} disabled={busy || !connected || isDemo}
          onPress={() => void run(saveReflection)} />
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      </ScrollView>
    </Animated.View>
  </SafeAreaView></SafeAreaProvider>;
}

function Stat({ value, text }: { value: string; text: string }) {
  return <View style={s.stat}><Text style={s.statValue}>{value}</Text><Text style={ui.hint}>{text}</Text></View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, overflow: "hidden" },
  panel: { position: "absolute", top: 12, right: 12, backgroundColor: "white", borderRadius: 18,
    borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  panelContent: { padding: 18, gap: 12 },
  top: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8, width: "100%", maxWidth: 760, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  appName: { fontSize: 18, fontWeight: "700", color: colors.ink },
  user: { flex: 1, textAlign: "right", color: colors.muted, fontSize: 13 },
  content: { padding: 16, paddingTop: 4, paddingBottom: 40, width: "100%", maxWidth: 760, alignSelf: "center" },
  stack: { gap: 14 }, hidden: { display: "none" },
  error: { padding: 12, backgroundColor: "#fff0ed", color: "#9a2920", borderRadius: 10 },
  notice: { padding: 12, backgroundColor: "#deeee4", color: "#234e3d", borderRadius: 10 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 4 },
  checkArea: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  check: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.primary, justifyContent: "center", alignItems: "center" },
  checkOn: { backgroundColor: colors.primary }, checkMark: { color: "white", fontWeight: "700", fontSize: 16 },
  taskBody: { flex: 1, minHeight: 44, justifyContent: "center", gap: 2, paddingVertical: 6 },
  taskTitle: { fontSize: 16, color: "#243e33", fontWeight: "600" }, done: { textDecorationLine: "line-through", color: "#738179" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  badge: { fontSize: 11, fontWeight: "700", color: colors.primary, backgroundColor: colors.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  minutesInput: { width: 90 },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
  suggestion: { padding: 14, backgroundColor: colors.soft, borderRadius: 12, gap: 10 },
  rest: { backgroundColor: "#f4f1ea" },
  listRow: { gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, minWidth: 80, padding: 10, borderRadius: 10, backgroundColor: colors.soft, alignItems: "center", gap: 2 },
  statValue: { fontSize: 20, fontWeight: "700", color: colors.ink },
});
