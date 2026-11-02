import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ViewStyle } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Achievement, Activity, ActivityAction, api, Condition, ConditionLevel, Reflection, Suggestions, Task, TaskGroup, WorkPlan } from "./api";
import CalendarPanel from "./CalendarPanel";
import FocusCard from "./FocusCard";
import { canDrop, dropLabel, findDropArea, groupByName, type DropArea, type DropTarget } from "./dragDrop";
import { todayLog } from "./activityLog";
import TaskDonut from "./TaskDonut";
import TaskForm, { type TaskPayload } from "./TaskForm";
import TaskGroupPanel, { GroupChips } from "./TaskGroupPanel";
import { filterTasks, groupSections, type GroupFilter } from "./taskGroups";
import { deadlinePassed } from "./taskStats";
import { isDemo } from "./demo";
import { askNotificationPermission, scheduleNotification } from "./notify";
import { Button, Card, colors, Details, Hint, Input, Label, Row, Stars, Tabs, TimeField, s as ui } from "./ui";

type Tab = "now" | "calendar";
const conditions: [ConditionLevel, string][] = [
  ["slightly_tired", "少し疲れてる"],
  ["tired", "疲れてる"],
  ["normal", "普通"],
  ["slightly_good", "少し元気"],
  ["good", "元気"],
];
const achievements: [Achievement, string][] = [["done", "できた"], ["partial", "途中まで"], ["not_done", "できなかった"]];
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
// 並び替え用。時刻なしの締切はその日の終わり、締切なしは最後として扱う。
const deadlineKey = (deadline: string | null) => !deadline ? "9999-12-31T99:99" : deadline.length === 10 ? `${deadline}T24:00` : deadline;
// 締切の表示。日付は日本時間で数え、時刻付きならその時刻を過ぎたら「締切切れ」にする。
function deadlineLabel(deadline: string, now: number): [string, "over" | "soon" | "later"] {
  const day = deadline.slice(0, 10), time = deadline.slice(11, 16);
  const days = Math.round((Date.parse(day) - Date.parse(japanToday(now))) / 86400000);
  const weekday = "日月火水木金土"[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const at = time ? ` ${time}` : "";
  const passed = deadlinePassed(deadline, now);
  if (passed) return [`${shortDate(day)}${at} 締切切れ`, "over"];
  if (days === 0) return [`今日${at}まで`, "soon"];
  if (days === 1) return [`明日${at}まで`, "soon"];
  return [`${shortDate(day)}(${weekday})${at}まで・あと${days}日`, days <= 3 ? "soon" : "later"];
}

export default function Dashboard({ username, logout }: { username: string; logout: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>("now");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [condition, setCondition] = useState<Condition | null>(null);
  const [aiConfigured, setAIConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  // 編集時に、スクロール領域からフォームの位置を測る。
  const taskCard = useRef<View>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  // 一覧の行で「グループを変更」を開いているタスク。
  const [moving, setMoving] = useState<number | null>(null);
  const [available, setAvailable] = useState("30");
  const [currentPlace, setCurrentPlace] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  // 取り組み中の記録（タイマー）と、振り返りに出す最近の記録。
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  // 「休む」を押したあと、休憩時間を選んでいる間だけ true。
  const [restOpen, setRestOpen] = useState(false);
  // ドラッグでグループを変える。落とし先の部品と、ドラッグ中の位置・候補を覚える。
  const dropViews = useRef(new Map<string, { view: View; target: DropTarget }>());
  const dragging = useRef<{ taskId: number; areas: DropArea[]; scrollAt: number; captured: boolean; y: number; top: number; bottom: number } | null>(null);
  const [drag, setDrag] = useState<{ task: Task; key: string | null; label: string | null } | null>(null);
  const ghostY = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(0);
  const scrollBox = useRef<View>(null);
  const tasksRef = useRef<Task[]>([]);
  // 移動の直後だけ出す「元に戻す」。
  // createdGroupId は、名前を入れて新しく作ったグループ（元に戻すときに空なら消す）。
  const [undo, setUndo] = useState<{ text: string; taskId: number; group_id: number | null; createdGroupId?: number } | null>(null);
  // 「グループを変更」で入力中のグループ名。
  const [groupName, setGroupName] = useState("");
  const [calendarLinked, setCalendarLinked] = useState(false);
  const [calendarReload, setCalendarReload] = useState(0);
  const [useCalendar, setUseCalendar] = useState(true);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [achievement, setAchievement] = useState<Achievement | null>(null);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [tiredness, setTiredness] = useState<ConditionLevel | null>(null);
  const [comment, setComment] = useState("");
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [endDraft, setEndDraft] = useState("");
  const [reflectionOpen, setReflectionOpen] = useState(false);
  // 「あとで」を押したら、この時刻まで横からのパネルを出さない。
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const panelWidth = Math.min(400, screenWidth - 24);
  // 横に広い画面ではホームを左右2列に並べ、スクロールを減らす（スマホは縦1列のまま）。
  const wide = screenWidth >= 960;
  const [now, setNow] = useState(Date.now());
  const reflectionDay = japanToday(now);
  const todayReflection = reflections.find(r => r.day === reflectionDay);
  // 終了予定は保存した日（日本時間）だけ有効。日付が変わったら前日の予定で振り返りを出さない。
  const workEnd = plan?.day === reflectionDay ? plan.end_time : null;
  // 入力欄は保存済みの終了予定で初期化する。
  useEffect(() => { setEndDraft(workEnd ?? ""); }, [workEnd]);
  const conditionFresh = !!condition && now < Date.parse(condition.expires_at);
  // 終了予定は日本時間の今日の時刻として扱う。
  const dueAt = workEnd ? Date.parse(`${reflectionDay}T${workEnd}:00+09:00`) - REFLECTION_LEAD : null;
  const reflectionDue = dueAt !== null && now >= dueAt && !todayReflection;
  const showReflection = (reflectionDue && now >= snoozeUntil) || reflectionOpen;
  // 画面の右端から振り返りパネルをすべり込ませる。
  const [panelMounted, setPanelMounted] = useState(false);
  useEffect(() => {
    if (showReflection) setPanelMounted(true);
    Animated.timing(slide, { toValue: showReflection ? 1 : 0, duration: 280, useNativeDriver: Platform.OS !== "web" })
      .start(({ finished }) => { if (finished && !showReflection) setPanelMounted(false); });
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
  tasksRef.current = tasks;
  // ドラッグ中に画面の上端・下端へ寄せたら自動でスクロールする。
  useEffect(() => {
    if (!drag) return;
    const frame = requestAnimationFrame(measureDrop);
    const timer = setInterval(() => {
      const state = dragging.current;
      if (!state) return;
      const delta = state.y < state.top + 60 ? -12 : state.y > state.bottom - 60 ? 12 : 0;
      if (!delta) return;
      scroll.current?.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: false });
      showHover();
    }, 30);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); };
  }, [drag?.task.id]);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  // 取り組みの予定時刻になったらブラウザで知らせる（延長したら付け直す）。
  useEffect(() => {
    if (!activity?.ends_at) return;
    const rest = activity.kind === "rest";
    return scheduleNotification(Date.parse(activity.ends_at), rest ? "休憩の時間が終わりました" : "時間になりました",
      rest ? "そろそろ再開しましょう。" : `「${activity.task_title ?? "タスク"}」は終わりましたか？`,
      () => changeTab("now"), "ictsol-focus");
  }, [activity?.id, activity?.ends_at]);
  useEffect(() => {
    setAchievement(todayReflection?.achievement ?? null); setSatisfaction(todayReflection?.satisfaction ?? null);
    setTiredness(todayReflection?.tiredness ?? null); setComment(todayReflection?.comment ?? "");
  }, [reflectionDay, todayReflection?.updated_at]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice(""); setUndo(null);
    try { await work(); } catch (e) {
      setError(e instanceof Error ? e.message : "通信できませんでした。");
    }
    finally { lock.current = false; setBusy(false); }
  }
  function invalidate() { setSuggestions(null); setRestOpen(false); }
  async function refresh() {
    const [nextTasks, nextCondition, config, nextReflections, nextPlan, nextGroups] = await Promise.all([
      api<Task[]>("/tasks"), api<Condition | null>("/condition"), api<{ ai_configured: boolean }>("/config"),
      api<Reflection[]>("/reflections"), api<WorkPlan | null>("/reflections/plan"),
      api<TaskGroup[]>("/groups"),
    ]);
    await loadActivities();
    setGroups(nextGroups);
    setGroupFilter(value => typeof value === "number" && !nextGroups.some(group => group.id === value) ? "all" : value);
    setPlan(nextPlan);
    setNow(Date.now()); setReflections(nextReflections);
    setTasks(nextTasks); setCondition(nextCondition); setAIConfigured(config.ai_configured); setConnected(true); invalidate();
  }
  useEffect(() => { void run(refresh); }, []);

  function changeTab(next: Tab) { setTab(next); scroll.current?.scrollTo({ y: 0, animated: false }); }
  function resetForm() { setEditing(null); }
  function scrollToForm() {
    const content = scroll.current?.getInnerViewNode();
    if (content) taskCard.current?.measureLayout(content, (_left, top) => scroll.current?.scrollTo({ y: top, animated: true }));
  }
  function startEdit(task: Task) { setEditing(task.id); scrollToForm(); }
  function integer(value: string) {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1440) throw new Error("時間は1〜1440分の整数で入力してください。");
    return Number(value);
  }
  // id が null なら追加、それ以外はそのタスクを更新する。
  async function saveTask(value: TaskPayload, id: number | null) {
    await api<Task>(id === null ? "/tasks" : `/tasks/${id}`, id === null ? "POST" : "PUT", value);
    setTasks(await api<Task[]>("/tasks"));
    if (id !== null) resetForm();
    invalidate(); setNotice(id === null ? `「${value.title}」を追加しました。` : "タスクを保存しました。");
  }
  async function toggleTask(task: Task) {
    await api<Task>(`/tasks/${task.id}`, "PATCH", { completed: !task.completed });
    setTasks(await api<Task[]>("/tasks")); invalidate();
  }
  // グループだけを変えて保存する（他の項目は今の値のまま送る）。
  async function putGroup(task: Task, groupId: number | null) {
    await api<Task>(`/tasks/${task.id}`, "PUT", { title: task.title, minutes: task.minutes, deadline: task.deadline, priority: task.priority,
      concentration: task.concentration, place: task.place, group_id: groupId });
  }
  async function moveTask(task: Task, target: DropTarget, createdGroupId?: number) {
    await putGroup(task, target.groupId);
    const [nextTasks, nextGroups] = await Promise.all([api<Task[]>("/tasks"), api<TaskGroup[]>("/groups")]);
    setTasks(nextTasks); setGroups(nextGroups); invalidate(); setMoving(null);
    setUndo({ text: createdGroupId === undefined ? `「${task.title}」を「${target.name}」に移しました。`
      : `グループ「${target.name}」を作って「${task.title}」を入れました。`, taskId: task.id, group_id: task.group_id, createdGroupId });
  }
  async function undoMove(saved: NonNullable<typeof undo>) {
    const task = tasks.find(value => value.id === saved.taskId);
    if (!task) throw new Error("移したタスクが見つかりません。");
    await putGroup(task, saved.group_id);
    const nextTasks = await api<Task[]>("/tasks");
    // 名前を入れて作ったグループが空になったら、一緒に消して元どおりにする。
    if (saved.createdGroupId !== undefined && !nextTasks.some(value => value.group_id === saved.createdGroupId)) {
      await api(`/groups/${saved.createdGroupId}`, "DELETE");
    }
    setTasks(nextTasks); setGroups(await api<TaskGroup[]>("/groups")); invalidate(); setNotice("元に戻しました。");
  }
  // 入力した名前のグループに入れる。同じ名前がなければ、その名前のグループを新しく作る。
  async function moveByName(task: Task, text: string) {
    const name = text.trim();
    if (!name) throw new Error("グループ名を入力してください。");
    const found = groupByName(groups, name);
    if (found) {
      if (found.id === task.group_id) throw new Error(`もう「${name}」に入っています。`);
      await moveTask(task, { groupId: found.id, name: found.name });
      return;
    }
    if (name.length > 30) throw new Error("グループ名は30文字以内にしてください。");
    const created = await api<TaskGroup>("/groups", "POST", { name });
    await moveTask(task, { groupId: created.id, name: created.name }, created.id);
  }
  // 落とし先として登録する（グループの見出し）。
  const dropArea = (key: string, target: DropTarget) => (view: View | null) => {
    if (view) dropViews.current.set(key, { view, target }); else dropViews.current.delete(key);
  };
  // 長押しで持ち上げる。落とし先の画面上の位置をまとめて測っておく。
  function startDrag(task: Task, pageY: number) {
    if (busy || isDemo || task.completed) return;
    const state = { taskId: task.id, areas: [] as DropArea[], scrollAt: scrollY.current, captured: false, y: pageY, top: 0, bottom: screenHeight };
    dragging.current = state;
    ghostY.setValue(pageY - 30);
    setDrag({ task, key: null, label: null });
  }
  // 持ち上げたあとの表示で位置がずれることがあるため、描画後に落とし先の位置を測る。
  function measureDrop() {
    const state = dragging.current;
    if (!state) return;
    const areas: DropArea[] = [];
    state.areas = areas; state.scrollAt = scrollY.current;
    for (const [key, { view, target }] of dropViews.current) {
      view.measureInWindow((_x, top, _width, height) => { areas.push({ key, target, top, height }); showHover(); });
    }
    scrollBox.current?.measureInWindow((_x, top, _width, height) => { state.top = top; state.bottom = top + height; });
  }
  // 今の指の位置から落とし先を決める（スクロールした分だけ位置をずらす）。
  function hoverDrop() {
    const state = dragging.current;
    if (!state) return null;
    const shift = scrollY.current - state.scrollAt;
    const area = findDropArea(state.areas.map(value => ({ ...value, top: value.top - shift })), state.y);
    return area && canDrop(tasksRef.current, state.taskId, area.target) ? area : null;
  }
  function showHover() {
    const hover = hoverDrop();
    setDrag(value => value && { ...value, key: hover?.key ?? null, label: hover ? dropLabel(hover.target) : null });
  }
  function moveDrag(pageY: number) {
    const state = dragging.current;
    if (!state) return;
    state.y = pageY; state.captured = true;
    ghostY.setValue(pageY - 30);
    showHover();
  }
  function endDrag(drop: boolean) {
    const hover = drop ? hoverDrop() : null;
    const task = tasksRef.current.find(value => value.id === dragging.current?.taskId);
    dragging.current = null; setDrag(null);
    if (hover && task) void run(() => moveTask(task, hover.target));
  }
  async function deleteTask(task: Task) {
    await api(`/tasks/${task.id}`, "DELETE");
    setTasks(await api<Task[]>("/tasks")); setConfirmDelete(null); invalidate();
    if (editing === task.id) resetForm();
    setNotice("タスクを削除しました。");
  }
  async function loadActivities() {
    const [current, list] = await Promise.all([api<Activity | null>("/activities/current"), api<Activity[]>("/activities")]);
    setActivity(current); setActivities(list);
  }
  // 提案から選ぶと取り組み（休憩）タイマーを始める。前の取り組みはサーバーで中断扱いになる。
  async function choose(taskId: number | null, rank: number | null, minutes: number) {
    askNotificationPermission();
    await api<Activity>("/activities", "POST", { task_id: taskId, rank, minutes });
    await loadActivities(); setRestOpen(false);
    setNotice(taskId === null ? `${minutes}分の休憩を始めました。ゆっくり休みましょう。` : "取り組みを始めました。終わったら「終わった」を押してください。");
    scroll.current?.scrollTo({ y: 0, animated: true });
  }
  async function act(action: ActivityAction, extra?: number) {
    if (!activity) return;
    const name = activity.kind === "rest" ? "休憩" : `「${activity.task_title ?? "タスク"}」`;
    await api<Activity>(`/activities/${activity.id}`, "PATCH", { action, ...(extra ? { minutes: extra } : {}) });
    const [nextTasks] = await Promise.all([api<Task[]>("/tasks"), loadActivities()]);
    setTasks(nextTasks); invalidate();
    setNotice(action === "extend" ? `${extra}分延長しました。`
      : action === "finish" ? (activity.kind === "rest" ? "休憩おわり。おつかれさまでした。" : `${name}を完了にしました。おつかれさまでした。`)
      : action === "partial" ? `${name}を途中までとして記録しました。` : `${name}をやめました。`);
  }
  async function saveReflection() {
    if (japanToday(Date.now()) !== reflectionDay) {
      setNow(Date.now());
      throw new Error("日付が変わりました。今日の振り返りを入力し直してください。");
    }
    if (!achievement || !satisfaction || !tiredness) throw new Error("振り返りの3つの質問すべてに答えてください。");
    const saved = await api<Reflection>("/reflections/today", "PUT", { achievement, satisfaction, tiredness, comment: comment.trim() });
    setReflections(previous => [saved, ...previous.filter(r => r.day !== saved.day)].slice(0, 14));
    setReflectionOpen(false);
    setNotice("今日の振り返りを保存しました。おつかれさまでした。");
  }
  const compare = (first: Task, second: Task) => deadlineKey(first.deadline).localeCompare(deadlineKey(second.deadline));
  const filtered = filterTasks(tasks, groupFilter);
  const open = filtered.filter(t => !t.completed);
  const done = filtered.filter(t => t.completed);
  const editingTask = editing === null ? null : tasks.find(task => task.id === editing) ?? null;
  const filterGroupId = typeof groupFilter === "number" ? groupFilter : null;
  const places = [...new Set(tasks.map(t => t.place.trim()).filter(Boolean))];
  const aiBlocked = !connected ? "サーバーに接続できていません。↻で再読み込みしてください。"
    : !aiConfigured ? "AI提案は準備中です。"
    : !conditionFresh ? "先に「今の調子」を選んでください。" : "";
  const setAvailableAndReset = (value: string) => { setAvailable(value); invalidate(); };
  // 休憩時間の初期の選択。使える時間に収まる範囲で15分に近いもの。
  const restDefault = [15, 10, 5].find(value => value <= (suggestions?.available_minutes ?? 15)) ?? 5;
  const log = todayLog(activities, now);
  function saveWorkEnd(text: string) {
    // 許可ダイアログはボタン操作の直後に出す必要があるため、通信より先に求める。
    askNotificationPermission();
    void run(async () => {
      const end = normalizeTime(text);
      if (!end) throw new Error("終了時刻は 18:30 のように入力してください。");
      const saved = await api<WorkPlan>("/reflections/plan", "PUT", { end_time: end });
      setPlan(saved); setNow(Date.now());
      const due = Date.parse(`${saved.day}T${saved.end_time}:00+09:00`) - REFLECTION_LEAD;
      setNotice(due <= Date.now() ? "終了予定が近いので、振り返りを出しました。" : "終了予定を保存しました。");
    });
  }

  // 一覧の行の下に開く「グループを変更」。名前を入れるか一覧から選ぶと、すぐ移して「元に戻す」を出す。
  function groupPicker(task: Task) {
    const name = groupName.trim(), found = name ? groupByName(groups, name) : null;
    // 入力中の文字を含む既存のグループ名を候補に出す。
    const similar = name ? groups.filter(group => group.name.includes(name) && group.name !== name).slice(0, 5) : [];
    const choices: DropTarget[] = [...groups.map(group => ({ groupId: group.id, name: group.name })), { groupId: null, name: "未分類" }];
    return <View style={s.picker}>
      <Hint>「{task.title}」を入れるグループの名前を入れてください。ない名前なら新しく作ります。</Hint>
      <Row>
        <View style={s.nameInput}><Input label="グループ名" hideLabel value={groupName} set={setGroupName} placeholder="例：レポート課題" disabled={busy} maxLength={30} /></View>
        <Button small primary title="決定" disabled={busy || !name || found?.id === task.group_id} onPress={() => void run(() => moveByName(task, groupName))} />
      </Row>
      {!!name && <Hint>{found ? found.id === task.group_id ? `もう「${found.name}」に入っています` : `「${found.name}」に入れます` : `新しいグループ「${name}」を作って入れます`}</Hint>}
      {!!similar.length && <Row>{similar.map(group => <Button key={group.id} small title={group.name} disabled={busy} onPress={() => setGroupName(group.name)} />)}</Row>}
      <Label>または選ぶ</Label>
      <Row>{choices.map(target => <View key={String(target.groupId)} style={{ maxWidth: "100%" }}>
        <Button small title={target.name} selected={task.group_id === target.groupId}
          disabled={busy || task.group_id === target.groupId} onPress={() => void run(() => moveTask(task, target))} />
      </View>)}</Row>
      <Row><Button small title="やめる" disabled={busy} onPress={() => setMoving(null)} /></Row>
    </View>;
  }

  // 描画のたびに部品を作り直さないよう、関数として呼び出す。
  function taskRow(task: Task, draggable = false) {
    const meta = [`${task.minutes}分`, task.place].filter(Boolean).join(" · ");
    const due = task.deadline && !task.completed ? deadlineLabel(task.deadline, now) : null;
    // 絞り込みなしでグループ見出しがないときは、どのグループかを行に出す。
    const group = !draggable && groupFilter === "all" ? groups.find(value => value.id === task.group_id) : null;
    return <View key={task.id} style={[s.taskRow, drag?.task.id === task.id && s.dragging]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}を編集`} disabled={busy}
        accessibilityHint={draggable && !isDemo ? "長押ししてグループの見出しに離すと、グループを変更できます" : undefined}
        onPress={() => startEdit(task)} delayLongPress={300}
        onLongPress={draggable ? event => startDrag(task, event.nativeEvent.pageY) : undefined}
        // 長押しのあと動かさずに離したら、ドラッグをやめる。
        onPressOut={() => setTimeout(() => { if (dragging.current && !dragging.current.captured) endDrag(false); }, 50)}
        style={[s.taskBody, Platform.OS === "web" && draggable && noSelect]}>
        <Text style={[s.taskTitle, task.completed && s.done]}>{task.title}</Text>
        <View style={s.metaRow}>
          {due && <Text style={[s.due, due[1] === "over" ? s.dueOver : due[1] === "soon" ? s.dueSoon : null]}>{due[0]}</Text>}
          {task.completed && !!task.deadline && <Text style={ui.hint}>締切 {shortDate(task.deadline)}{task.deadline.slice(10).replace("T", " ")}</Text>}
          <Text style={ui.hint}>{meta}</Text>
          {group && <Text style={ui.hint}>🏷 {group.name}</Text>}
          {task.priority === "high" && <Text style={s.badge}>優先</Text>}
          {task.concentration === "high" && <Text style={s.badge}>集中</Text>}
        </View>
      </Pressable>
      <Row>
        {confirmDelete === task.id ? <>
          <Button small title="本当に削除" label={`${task.title}を本当に削除`} disabled={busy || isDemo}
            onPress={() => void run(() => deleteTask(task))} />
          <Button small title="やめる" disabled={busy} onPress={() => setConfirmDelete(null)} />
        </> : <>
        <Button small title={task.completed ? "戻す" : "✓ 完了"}
          label={`${task.title}を${task.completed ? "未完了に戻す" : "完了にする"}`} disabled={busy}
          onPress={() => void run(() => toggleTask(task))} />
        <Button small title={moving === task.id ? "▾ グループを変更" : "グループを変更"} label={`${task.title}のグループを変更`} selected={moving === task.id}
          disabled={busy || isDemo} onPress={() => { setMoving(moving === task.id ? null : task.id); setConfirmDelete(null); setGroupName(""); }} />
        <Button small title="削除" label={`${task.title}を削除`} disabled={busy || isDemo}
          onPress={() => { setConfirmDelete(task.id); setMoving(null); }} />
        </>}
      </Row>
      {moving === task.id && groupPicker(task)}
    </View>;
  }

  const hidden = (key: Tab) => tab !== key && s.hidden;

  return <SafeAreaProvider><SafeAreaView style={s.root}><StatusBar style="dark" />
    <View style={[s.top, wide && s.wideWidth]}>
      <View style={s.header}>
        <Text style={s.appName}>ICTsol F1</Text>
        <Text numberOfLines={1} style={s.user}>{username}</Text>
        <Button small title={busy ? "…" : "↻"} label="最新の状態に更新" disabled={busy}
          onPress={() => void run(async () => { await refresh(); setCalendarReload(n => n + 1); })} />
        <Button small title="ログアウト" disabled={busy} onPress={() => void run(logout)} />
      </View>
      <Tabs tabs={[["now", "ホーム"], ["calendar", "カレンダー"]]}
        value={tab} set={changeTab} />
      {isDemo && <Hint>デモ画面です（保存・AIは動きません）</Hint>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
      {undo && <View style={s.undo}><Text accessibilityLiveRegion="polite" style={s.undoText}>{undo.text}</Text>
        <Button small title="元に戻す" disabled={busy} onPress={() => { const saved = undo; void run(() => undoMove(saved)); }} /></View>}
    </View>
    {/* 長押しで持ち上げたあとの指の動きは、この View が受け取る */}
    <View ref={scrollBox} style={s.scrollBox}
      onMoveShouldSetResponderCapture={() => !!dragging.current}
      onResponderGrant={() => { if (dragging.current) dragging.current.captured = true; }}
      onResponderMove={event => moveDrag(event.nativeEvent.pageY)}
      onResponderRelease={() => endDrag(true)}
      onResponderTerminationRequest={() => !dragging.current}
      onResponderTerminate={() => endDrag(false)}>
    <ScrollView ref={scroll} contentContainerStyle={[s.content, wide && s.wideWidth]} keyboardShouldPersistTaps="handled"
      scrollEnabled={!drag} scrollEventThrottle={16} onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }}>

      {/* ホーム：調子 → 提案 → やること → 記録 の順に上から操作する */}
      <View style={[wide ? s.columns : s.stack, hidden("now")]}>
        {/* 左（スマホでは上）：調子 → 提案 → 振り返り */}
        <View style={[s.stack, wide && s.column]}>
          {activity && <FocusCard activity={activity} disabled={busy || isDemo} act={(action, extra) => void run(() => act(action, extra))} />}
          <Card title="今の調子は？">
            <Row>{conditions.map(([key, text]) => <Button key={key} title={text} disabled={busy || !connected}
              selected={conditionFresh && condition?.level === key} onPress={() => void run(async () => {
                const saved = await api<Condition>("/condition", "PUT", { level: key });
                setCondition(saved); setNow(Date.now()); invalidate(); setNotice("今の調子を保存しました。");
              })} />)}</Row>
            {condition && !conditionFresh && <Hint warn>日付が変わりました。今日の調子を選んでください。</Hint>}
            <Label>今日は何時まで作業する？</Label>
            <Row>
              <TimeField label="作業の終了時刻" value={endDraft} set={setEndDraft} disabled={busy || !connected || isDemo} />
              <Button small primary title={workEnd ? "変更" : "決定"} disabled={busy || !connected || isDemo || !endDraft || endDraft === workEnd}
                onPress={() => saveWorkEnd(endDraft)} />
            </Row>
            {dueAt !== null && !todayReflection && !reflectionDue && <Hint>🔔 {clock(dueAt)}ごろに振り返りをお知らせします</Hint>}
          </Card>

          <Card title="AIに次の一歩を提案してもらう">
            <Label>使える時間</Label>
            <Row>
              <View style={s.minutesInput}><Input label="使える時間（分）" hideLabel value={available} set={setAvailableAndReset} numeric placeholder="分" disabled={busy} /></View>
              <Text style={ui.hint}>分</Text>
            </Row>
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
              <Hint>候補タスク・今の調子・使える時間・場所と、過去7回分の朝の調子と振り返り（コメントを含む）、過去14日分の取り組み記録（選んだタスク名・休憩・結果）を送信します。</Hint>
              <Hint>無料枠では送信内容がGoogleの製品改善に使われる場合があります。個人情報・機密情報は入力しないでください。</Hint>
            </Details>
          </Card>

          {suggestions && <Card title={suggestions.source === "ai" ? "どれか1つ選んでください" : "今できるタスクはありません"}
            right={<Hint>{suggestions.available_minutes}分</Hint>}>
            {!!activity && <Hint>今の取り組みがあります。新しく選ぶと、今の取り組みは「中断」として記録されます。</Hint>}
            {suggestions.choices.map(({ task, reason }, index) => {
              const active = activity?.kind === "task" && activity.task_id === task.id;
              return <View key={task.id} style={s.suggestion}>
                <Text style={s.taskTitle}>{index === 0 ? "おすすめ　" : ""}{task.title}　<Text style={ui.hint}>{task.minutes}分</Text></Text>
                <Text style={s.body}>{reason}</Text>
                <Button title={active ? "✓ 取り組み中" : `これにする（${Math.min(task.minutes, 240)}分タイマー）`} selected={active}
                  disabled={busy || isDemo || active} onPress={() => void run(() => choose(task.id, index + 1, Math.min(task.minutes, 240)))} />
              </View>;
            })}
            <View style={[s.suggestion, s.rest]}>
              <Text style={s.taskTitle}>ひと休みする</Text>
              <Text style={s.body}>{suggestions.rest_reason}</Text>
              {activity?.kind === "rest" ? <Button title="✓ 休憩中" selected disabled onPress={() => undefined} />
                : restOpen ? <>
                  <Label>何分休む？</Label>
                  <Row>{[5, 10, 15, 30].map(value => <Button key={value} small title={`${value}分`}
                    selected={value === restDefault} disabled={busy || isDemo} onPress={() => void run(() => choose(null, null, value))} />)}
                    <Button small title="やめる" disabled={busy} onPress={() => setRestOpen(false)} /></Row>
                </> : <Button title="休む" disabled={busy || isDemo} onPress={() => setRestOpen(true)} />}
            </View>
          </Card>}

          {/* 振り返り：通知を待たずに答えたいとき・答え直したいときの入口（過去の回答は表示しない） */}
          <Card title="今日の振り返り" right={todayReflection ? <Hint>回答済み ✓</Hint> : workEnd ? <Hint>{workEnd}まで</Hint> : undefined}>
            {!showReflection && <Row><Button small title={todayReflection ? "答え直す" : "今すぐ振り返る"} disabled={busy || isDemo}
              onPress={() => setReflectionOpen(true)} /></Row>}
          </Card>
        </View>
        {/* 右（スマホでは下）：やること */}
        <View ref={taskCard} style={[s.stack, wide && s.column]}>
          {/* やること：追加・編集フォームと一覧を1枚にまとめる */}
          <View>
          <Card title={editingTask ? "タスクを編集" : `やること ${open.length}件`}>
            <TaskForm key={editingTask?.id ?? "new"} task={editingTask} groups={groups} defaultGroupId={filterGroupId}
              disabled={busy || !connected} run={run} save={value => saveTask(value, editingTask?.id ?? null)}
              cancel={editingTask ? resetForm : undefined} />
            {!tasks.length && <Hint>まだタスクがありません。上の欄から追加しましょう。</Hint>}
            <Label>グループで絞り込み</Label>
            <GroupChips groups={groups} value={groupFilter} all unclassified={tasks.some(task => task.group_id === null)}
              disabled={busy} set={setGroupFilter} />
            <TaskDonut tasks={filtered} now={now} />
            {groupFilter === "all" && groups.length > 0 ? groupSections(open.slice().sort(compare), groups).map(section =>
              <View key={String(section.id)} style={{ gap: 6 }}>
                <View ref={dropArea(`group:${section.id}`, { groupId: section.id, name: section.name })}
                  style={[s.dropHeader, drag?.key === `group:${section.id}` && s.dropHover]}>
                  <Label>{section.name}・未完了 {section.tasks.length}件</Label>
                </View>
                {section.tasks.length ? section.tasks.map(task => taskRow(task, true)) : <Hint>タスクはありません</Hint>}
              </View>) : open.slice().sort(compare).map(task => taskRow(task))}
            {groupFilter === "all" && groups.length > 0 && open.length > 0 && !isDemo && <Hint>「グループを変更」か、長押ししてグループの見出しに離すと、グループを移せます</Hint>}
            {!!done.length && <Details title={`完了済み（${done.length}件）`}>
              {done.slice().sort(compare).map(task => taskRow(task))}
            </Details>}
            {!!tasks.length && <Hint>タスク名を押すと編集できます</Hint>}
            <TaskGroupPanel groups={groups} disabled={busy || !connected || isDemo} run={run} changed={refresh} />
          </Card>
          </View>
        </View>
      </View>

      {/* 予定：常に読み込んだままにし、連携状態をホームでも使う */}
      <View style={[s.stack, hidden("calendar")]}>
        <CalendarPanel disabled={busy || !connected} run={run} reload={calendarReload}
          changed={linked => { setCalendarLinked(linked); invalidate(); }} />
        {/* 予定を見ながらタスクも足せるようにする（一覧はホームに出る） */}
        <Card title="タスクを追加" right={<Hint>未完了 {tasks.filter(task => !task.completed).length}件</Hint>}>
          <TaskForm groups={groups} disabled={busy || !connected} run={run} save={value => saveTask(value, null)} />
          <Hint>追加したタスクはホームの「やること」に表示されます</Hint>
        </Card>
      </View>

    </ScrollView>
    </View>
    {/* ドラッグ中のタスク。指に付いてきて、どこへ移すかを表示する */}
    {drag && <Animated.View pointerEvents="none" style={[s.ghost, { transform: [{ translateY: ghostY }] }]}>
      <Text numberOfLines={1} style={s.taskTitle}>{drag.task.title}</Text>
      <Text style={drag.label ? s.ghostLabel : ui.hint}>{drag.label ?? "ここには移せません"}</Text>
    </Animated.View>}
    {/* 振り返り：終了予定の30分前になると画面の横から出てくる */}
    {panelMounted && <Animated.View pointerEvents={showReflection ? "auto" : "none"} accessibilityViewIsModal={showReflection}
      style={[s.panel, { width: panelWidth, maxHeight: screenHeight - 24, opacity: slide,
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [panelWidth + 24, 0] }) }] }]}>
      <ScrollView contentContainerStyle={s.panelContent} keyboardShouldPersistTaps="handled">
        <View style={ui.cardHeading}>
          <Text style={ui.section}>🌙 今日の振り返り</Text>
          <Button small title={reflectionDue ? "あとで" : "閉じる"} disabled={busy} onPress={laterReflection} />
        </View>
        <Hint>おつかれさまでした。3つ答えたら1日の締めくくりです。</Hint>
        <Label>今日やったこと</Label>
        {log.length ? <View style={s.log}>{log.map(item => <Text key={item.id} style={s.logItem}>
          <Text style={ui.hint}>{item.time}　</Text>{item.text}</Text>)}</View>
          : <Hint>今日は提案から選んだ記録はありません。</Hint>}
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
    </Animated.View>}
  </SafeAreaView></SafeAreaProvider>;
}

// Web で長押し中に文字が選択されないようにする（ネイティブの型には無い指定のため別に持つ）。
const noSelect = { userSelect: "none" } as unknown as ViewStyle;

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
  stack: { gap: 14 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 14 }, column: { flex: 1, minWidth: 0 },
  wideWidth: { maxWidth: 1200 }, hidden: { display: "none" },
  error: { padding: 12, backgroundColor: "#fff0ed", color: "#9a2920", borderRadius: 10 },
  notice: { padding: 12, backgroundColor: "#deeee4", color: "#234e3d", borderRadius: 10 },
  taskRow: { gap: 6, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 },
  taskBody: { minWidth: 0, minHeight: 44, justifyContent: "center", gap: 2, paddingVertical: 6 },
  taskTitle: { fontSize: 16, color: "#243e33", fontWeight: "600" }, done: { textDecorationLine: "line-through", color: "#738179" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  minutesInput: { width: 90 },
  badge: { fontSize: 11, fontWeight: "700", color: colors.primary, backgroundColor: colors.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  due: { fontSize: 12, fontWeight: "700", color: colors.text, backgroundColor: colors.line, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  dueSoon: { color: "#8a4b00", backgroundColor: "#fdecc8" },
  dueOver: { color: "#9a2920", backgroundColor: "#fde2dd" },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
  suggestion: { padding: 14, backgroundColor: colors.soft, borderRadius: 12, gap: 10 },
  rest: { backgroundColor: "#f4f1ea" },
  scrollBox: { flex: 1 },
  picker: { gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.soft },
  nameInput: { flex: 1, minWidth: 160 },
  dropHover: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.soft, borderRadius: 10 },
  dragging: { opacity: 0.4 },
  dropHeader: { paddingVertical: 4, paddingHorizontal: 4 },
  ghost: { position: "absolute", top: 0, left: 16, right: 16, padding: 12, gap: 2, borderRadius: 12, backgroundColor: "white", opacity: 0.95,
    borderWidth: 2, borderColor: colors.primary, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  ghostLabel: { fontSize: 13, fontWeight: "700", color: colors.primary },
  undo: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, paddingLeft: 12, backgroundColor: "#deeee4", borderRadius: 10 },
  undoText: { flex: 1, color: "#234e3d" },
  log: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: colors.soft },
  logItem: { fontSize: 14, lineHeight: 21, color: colors.text },
});
