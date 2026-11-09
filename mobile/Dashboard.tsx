import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ViewStyle } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Achievement, Activity, ActivityAction, api, Condition, ConditionLevel, Reflection, Suggestions, Task, TaskGroup, WorkPlan } from "./api";
import CalendarPanel from "./CalendarPanel";
import FocusCard from "./FocusCard";
import { draftGroupName, dropAction, dropLabel, findDropArea, groupByName, type DropArea, type DropTarget, type GroupRef } from "./dragDrop";
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
  // 「＋ 追加」で入力欄を開いている間だけ true（普段は一覧を主役にして入力欄を閉じておく）。
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  // 「⋯」でメニュー（グループを変更・削除）を開いているタスク。
  const [menuFor, setMenuFor] = useState<number | null>(null);
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
  // マウスでタスクを押している間だけ持つ。長押しを待たず、動かし始めたらドラッグにする（タッチはスクロールと区別するため長押しのまま）。
  const pressing = useRef<{ task: Task; y: number } | null>(null);
  const groupsRef = useRef<TaskGroup[]>([]);
  // 移動の直後だけ出す「元に戻す」。moves は移したタスクと元のグループ。
  // createdGroupId は、名前を入れて新しく作ったグループ（元に戻すときに空なら消す）。
  const [undo, setUndo] = useState<{ text: string; moves: { taskId: number; group_id: number | null }[]; createdGroupId?: number } | null>(null);
  // 「グループを変更」で入力中のグループ名。
  const [groupName, setGroupName] = useState("");
  // 一覧でタスクを隠しているグループ（見出しを押して切り替える）。Webでは次に開いたときも同じ状態にする。
  const [collapsed, setCollapsed] = useState<number[]>(() => loadCollapsed(username));
  function updateCollapsed(change: (previous: number[]) => number[]) {
    setCollapsed(previous => {
      const next = change(previous);
      if (next.length !== previous.length || next.some((id, index) => id !== previous[index])) saveCollapsed(username, next);
      return next;
    });
  }
  function toggleCollapsed(groupId: number) {
    updateCollapsed(previous => previous.includes(groupId) ? previous.filter(id => id !== groupId) : [...previous, groupId]);
  }
  // タスクを移した先のグループが隠れていたら開いて、移したタスクが見えるようにする。
  const expandGroup = (groupId: number | null) => updateCollapsed(previous => previous.filter(id => id !== groupId));
  // 一覧のグループ見出しで名前を変えているグループ。
  // タスクどうしを重ねて仮の名前で作った直後も、ここで名前を付けてもらう。
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
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
    return scheduleNotification(dueAt, "振り返りの時間です", "今日の振り返りをしましょう。",
      () => { setNow(Date.now()); changeTab("now"); });
  }, [dueAt, !!todayReflection]);
  tasksRef.current = tasks;
  groupsRef.current = groups;
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
    // 消えたグループを「隠している」一覧に残さない。
    updateCollapsed(previous => previous.filter(id => nextGroups.some(group => group.id === id)));
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
  function startEdit(task: Task) { setAdding(false); setEditing(task.id); scrollToForm(); }
  function integer(value: string) {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1440) throw new Error("時間は1〜1440分で入力してください。");
    return Number(value);
  }
  // id が null なら追加、それ以外はそのタスクを更新する。
  async function saveTask(value: TaskPayload, id: number | null) {
    await api<Task>(id === null ? "/tasks" : `/tasks/${id}`, id === null ? "POST" : "PUT", value);
    setTasks(await api<Task[]>("/tasks"));
    if (id !== null) resetForm(); else setAdding(false);
    invalidate(); setNotice(id === null ? `「${value.title}」を追加しました。` : "保存しました。");
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
  async function reloadTasksAndGroups() {
    const [nextTasks, nextGroups] = await Promise.all([api<Task[]>("/tasks"), api<TaskGroup[]>("/groups")]);
    setTasks(nextTasks); setGroups(nextGroups); invalidate();
  }
  async function moveTask(task: Task, target: GroupRef, createdGroupId?: number) {
    await putGroup(task, target.groupId);
    await reloadTasksAndGroups(); setMoving(null); setMenuFor(null); expandGroup(target.groupId);
    setUndo({ text: createdGroupId === undefined ? `「${task.title}」を「${target.name}」に移しました。`
      : `「${target.name}」を作成し、「${task.title}」を移しました。`, moves: [{ taskId: task.id, group_id: task.group_id }], createdGroupId });
  }
  // タスクどうしを重ねたとき。先に仮の名前でグループを作って2つを入れ、そのあと見出しで名前を付けてもらう。
  async function groupTogether(dragged: Task, partner: Task) {
    const created = await api<TaskGroup>("/groups", "POST", { name: draftGroupName(groups) });
    try {
      // 落とされた側（相手）を先に入れて、一覧で相手の位置にグループができるようにする。
      for (const task of [partner, dragged]) await putGroup(task, created.id);
    } catch (error) {
      // 途中で失敗したら、入れた分を戻して作ったグループを消し、半端な状態を残さない。
      await Promise.allSettled([partner, dragged].map(task => putGroup(task, task.group_id)));
      await api(`/groups/${created.id}`, "DELETE").catch(() => undefined);
      await reloadTasksAndGroups().catch(() => undefined);
      throw error;
    }
    await reloadTasksAndGroups(); setMoving(null);
    setRenaming(created.id); setRenameDraft("");
    setUndo({ text: `「${partner.title}」と「${dragged.title}」をグループにしました。`,
      moves: [partner, dragged].map(task => ({ taskId: task.id, group_id: task.group_id })), createdGroupId: created.id });
  }
  // 一覧の見出しからグループの名前を変える。
  async function renameGroup(group: TaskGroup, text: string) {
    const name = text.trim();
    if (!name) throw new Error("グループ名を入力してください。");
    if (name !== group.name) {
      if (groupByName(groups, name)) throw new Error(`「${name}」は既にあります。`);
      await api(`/groups/${group.id}`, "PUT", { name });
      setGroups(await api<TaskGroup[]>("/groups"));
    }
    setRenaming(null); setNotice(`名前を「${name}」に変更しました。`);
  }
  async function undoMove(saved: NonNullable<typeof undo>) {
    for (const move of saved.moves) {
      const task = tasks.find(value => value.id === move.taskId);
      if (!task) throw new Error("移したタスクが見つかりません。");
      await putGroup(task, move.group_id);
    }
    if (renaming === saved.createdGroupId) setRenaming(null);
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
      if (found.id === task.group_id) throw new Error(`既に「${name}」に入っています。`);
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
    const action = area && dropAction(tasksRef.current, groupsRef.current, state.taskId, area.target);
    return area && action ? { key: area.key, action } : null;
  }
  function showHover() {
    const hover = hoverDrop();
    setDrag(value => value && { ...value, key: hover?.key ?? null, label: hover ? dropLabel(hover.action) : null });
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
    if (!hover || !task) return;
    const { action } = hover;
    void run(() => action.kind === "move" ? moveTask(task, action) : groupTogether(task, action.partner));
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
    setNotice(taskId === null ? `${minutes}分の休憩を始めました。` : "開始しました。");
    scroll.current?.scrollTo({ y: 0, animated: true });
  }
  async function act(action: ActivityAction, extra?: number) {
    if (!activity) return;
    const name = activity.kind === "rest" ? "休憩" : `「${activity.task_title ?? "タスク"}」`;
    await api<Activity>(`/activities/${activity.id}`, "PATCH", { action, ...(extra ? { minutes: extra } : {}) });
    const [nextTasks] = await Promise.all([api<Task[]>("/tasks"), loadActivities()]);
    setTasks(nextTasks); invalidate();
    setNotice(action === "extend" ? `${extra}分延長しました。`
      : action === "finish" ? (activity.kind === "rest" ? "休憩を終えました。" : `${name}を完了しました。`)
      : action === "partial" ? `${name}を途中までで記録しました。` : `${name}をやめました。`);
  }
  async function saveReflection() {
    if (japanToday(Date.now()) !== reflectionDay) {
      setNow(Date.now());
      throw new Error("日付が変わりました。もう一度入力してください。");
    }
    if (!achievement || !satisfaction || !tiredness) throw new Error("すべての項目に答えてください。");
    const saved = await api<Reflection>("/reflections/today", "PUT", { achievement, satisfaction, tiredness, comment: comment.trim() });
    setReflections(previous => [saved, ...previous.filter(r => r.day !== saved.day)].slice(0, 14));
    setReflectionOpen(false);
    setNotice("振り返りを保存しました。");
  }
  const compare = (first: Task, second: Task) => deadlineKey(first.deadline).localeCompare(deadlineKey(second.deadline));
  const filtered = filterTasks(tasks, groupFilter);
  const open = filtered.filter(t => !t.completed);
  const done = filtered.filter(t => t.completed);
  const editingTask = editing === null ? null : tasks.find(task => task.id === editing) ?? null;
  const filterGroupId = typeof groupFilter === "number" ? groupFilter : null;
  const places = [...new Set(tasks.map(t => t.place.trim()).filter(Boolean))];
  const aiBlocked = !connected ? "サーバーに接続できません。↻で再読み込みしてください。"
    : !aiConfigured ? "AI提案は準備中です。"
    : !conditionFresh ? "先に今の調子を選んでください。" : "";
  const setAvailableAndReset = (value: string) => { setAvailable(value); invalidate(); };
  // 休憩時間の初期の選択。使える時間に収まる範囲で15分に近いもの。
  const restDefault = [15, 10, 5].find(value => value <= (suggestions?.available_minutes ?? 15)) ?? 5;
  const log = todayLog(activities, now);
  function saveWorkEnd(text: string) {
    // 許可ダイアログはボタン操作の直後に出す必要があるため、通信より先に求める。
    askNotificationPermission();
    void run(async () => {
      const end = normalizeTime(text);
      if (!end) throw new Error("終了時刻は 18:30 の形で入力してください。");
      const saved = await api<WorkPlan>("/reflections/plan", "PUT", { end_time: end });
      setPlan(saved); setNow(Date.now());
      const due = Date.parse(`${saved.day}T${saved.end_time}:00+09:00`) - REFLECTION_LEAD;
      setNotice(due <= Date.now() ? "振り返りを表示しました。" : "終了時刻を保存しました。");
    });
  }

  // 一覧の行の下に開く「グループを変更」。名前を入れるか一覧から選ぶと、すぐ移して「元に戻す」を出す。
  function groupPicker(task: Task) {
    const name = groupName.trim(), found = name ? groupByName(groups, name) : null;
    const choices: GroupRef[] = [...groups.map(group => ({ groupId: group.id, name: group.name })), { groupId: null, name: "未分類" }];
    return <View style={s.picker}>
      <Row>
        <View style={s.nameInput}><Input label="グループ名" hideLabel value={groupName} set={setGroupName} placeholder="グループ名" disabled={busy} maxLength={30} /></View>
        <Button small primary title="決定" disabled={busy || !name || found?.id === task.group_id} onPress={() => void run(() => moveByName(task, groupName))} />
      </Row>
      {!!name && <Hint>{found ? found.id === task.group_id ? `既に「${found.name}」に入っています` : `「${found.name}」に移します` : `「${name}」を新しく作ります`}</Hint>}
      <Row>{choices.map(target => <View key={String(target.groupId)} style={{ maxWidth: "100%" }}>
        <Button small title={target.name} selected={task.group_id === target.groupId}
          disabled={busy || task.group_id === target.groupId} onPress={() => void run(() => moveTask(task, target))} />
      </View>)}</Row>
      <Row><Button small title="やめる" disabled={busy} onPress={() => setMoving(null)} /></Row>
    </View>;
  }

  // 一覧のグループ見出し。グループなら「名前を変更」で、その場で名前を付け直せる。
  function sectionHeading(section: { id: number | null; name: string; tasks: Task[] }) {
    const group = section.id === null ? null : groups.find(value => value.id === section.id) ?? null;
    if (group && renaming === group.id) {
      const save = () => void run(() => renameGroup(group, renameDraft));
      return <View style={s.picker}>
        <Row>
          <View style={s.nameInput}><Input label={`${group.name}の新しい名前`} hideLabel value={renameDraft} set={setRenameDraft}
            placeholder="グループ名" disabled={busy} maxLength={30} autoFocus submit={save} /></View>
          <Button small primary title="決定" disabled={busy || !renameDraft.trim()} onPress={save} />
          <Button small title="あとで" disabled={busy} onPress={() => setRenaming(null)} />
        </Row>
      </View>;
    }
    const label = `${section.name}（${section.tasks.length}）`;
    if (!group) return <View style={s.headingRow}><View style={{ flex: 1 }}><Label>{label}</Label></View></View>;
    const hidden = collapsed.includes(group.id);
    return <View style={s.headingRow}>
      {/* 見出しを押すと、このグループのタスクを隠す・表示する */}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: !hidden }}
        accessibilityLabel={`${group.name}のタスクを${hidden ? "表示" : "隠す"}`}
        onPress={() => toggleCollapsed(group.id)} style={s.headingToggle}>
        <Label>{hidden ? "▸" : "▾"} {label}</Label>
      </Pressable>
      {group && !isDemo && <Pressable accessibilityRole="button" accessibilityLabel={`${group.name}の名前を変更`} disabled={busy} hitSlop={8}
        onPress={() => { setRenaming(group.id); setRenameDraft(group.name); }}>
        <Text style={s.link}>名前を変更</Text>
      </Pressable>}
    </View>;
  }

  // 描画のたびに部品を作り直さないよう、関数として呼び出す。
  // draggable なら長押しで持ち上げられ、ほかのタスクを重ねる落とし先にもなる。
  // inSection はグループ見出しの下に並べるとき（行にグループ名を出さない）。
  function taskRow(task: Task, draggable = false, inSection = false) {
    const meta = [`${task.minutes}分`, task.place].filter(Boolean).join(" · ");
    const due = task.deadline && !task.completed ? deadlineLabel(task.deadline, now) : null;
    // 絞り込みなしでグループ見出しがないときは、どのグループかを行に出す。
    const group = !inSection && groupFilter === "all" ? groups.find(value => value.id === task.group_id) : null;
    const key = `task:${task.id}`;
    return <View key={task.id} ref={draggable ? dropArea(key, { kind: "task", taskId: task.id }) : undefined}
      style={[s.taskRow, drag?.task.id === task.id && s.dragging, drag?.key === key && s.dropHover]}>
      <View style={s.rowLine}>
      {/* 左の丸：押すと完了・未完了を切り替える */}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.completed, disabled: busy }}
        accessibilityLabel={`${task.title}を${task.completed ? "未完了に戻す" : "完了にする"}`} disabled={busy}
        onPress={() => void run(() => toggleTask(task))} hitSlop={12} style={[s.check, task.completed && s.checkOn]}>
        {task.completed && <Text style={s.checkMark}>✓</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}を編集`} disabled={busy}
        accessibilityHint={draggable && !isDemo ? "長押ししてドラッグすると、グループを作成・変更できます" : undefined}
        onPress={() => startEdit(task)} delayLongPress={300}
        onLongPress={draggable ? event => startDrag(task, event.nativeEvent.pageY) : undefined}
        onPressIn={draggable && Platform.OS === "web" ? event => {
          // Webでは押し始めのイベントの種類でマウスかタッチかを見分ける。
          const type = (event.nativeEvent as unknown as { type?: string }).type;
          pressing.current = type === "touchstart" ? null : { task, y: event.nativeEvent.pageY };
        } : undefined}
        // 長押しのあと動かさずに離したら、ドラッグをやめる。
        onPressOut={() => { pressing.current = null; setTimeout(() => { if (dragging.current && !dragging.current.captured) endDrag(false); }, 50); }}
        style={[s.taskBody, { flex: 1 }, Platform.OS === "web" && draggable && noSelect]}>
        <Text style={[s.taskTitle, task.completed && s.done]}>{task.title}</Text>
        <View style={s.metaRow}>
          {due && <Text style={[s.due, due[1] === "over" ? s.dueOver : due[1] === "soon" ? s.dueSoon : null]}>{due[0]}</Text>}
          {task.completed && !!task.deadline && <Text style={ui.hint}>締切 {shortDate(task.deadline)}{task.deadline.slice(10).replace("T", " ")}</Text>}
          <Text style={ui.hint}>{meta}</Text>
          {group && <Text style={s.tag}>{group.name}</Text>}
          {task.priority === "high" && <Text style={s.badge}>優先</Text>}
          {task.concentration === "high" && <Text style={s.badge}>集中</Text>}
        </View>
      </Pressable>
      {/* 右の「⋯」：めったに使わない操作をまとめる */}
      {!isDemo && <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}のメニュー`}
        accessibilityState={{ expanded: menuFor === task.id }} disabled={busy} hitSlop={6}
        onPress={() => { const open = menuFor !== task.id; setMenuFor(open ? task.id : null); setMoving(null); setConfirmDelete(null); }}
        style={[s.more, menuFor === task.id && s.moreOn]}>
        <Text style={s.moreText}>⋯</Text>
      </Pressable>}
      </View>
      {menuFor === task.id && <Row>
        {confirmDelete === task.id ? <>
          <Button small title="本当に削除" label={`${task.title}を本当に削除`} disabled={busy}
            onPress={() => void run(async () => { await deleteTask(task); setMenuFor(null); })} />
          <Button small title="やめる" disabled={busy} onPress={() => setConfirmDelete(null)} />
        </> : <>
          {!task.completed && <Button small title="グループを変更" label={`${task.title}のグループを変更`} selected={moving === task.id}
            disabled={busy} onPress={() => { setMoving(moving === task.id ? null : task.id); setGroupName(""); }} />}
          <Button small title="削除" label={`${task.title}を削除`} disabled={busy}
            onPress={() => { setConfirmDelete(task.id); setMoving(null); }} />
        </>}
      </Row>}
      {menuFor === task.id && moving === task.id && groupPicker(task)}
    </View>;
  }

  const hidden = (key: Tab) => tab !== key && s.hidden;

  // ホームの各ブロック。画面の幅によって並べ方を変えるため、先に組み立てておく。
  const conditionBlock = <>
          {activity && <FocusCard activity={activity} disabled={busy || isDemo} act={(action, extra) => void run(() => act(action, extra))} />}
          <Card title="今の調子は？">
            <Row>{conditions.map(([key, text]) => <Button key={key} title={text} disabled={busy || !connected}
              selected={conditionFresh && condition?.level === key} onPress={() => void run(async () => {
                const saved = await api<Condition>("/condition", "PUT", { level: key });
                setCondition(saved); setNow(Date.now()); invalidate(); setNotice("今の調子を保存しました。");
              })} />)}</Row>
            {condition && !conditionFresh && <Hint warn>日付が変わりました。今日の調子を選んでください。</Hint>}
            <Label>作業の終了時刻</Label>
            <Row>
              <TimeField label="作業の終了時刻" value={endDraft} set={setEndDraft} disabled={busy || !connected || isDemo} />
              <Button small primary title={workEnd ? "変更" : "決定"} disabled={busy || !connected || isDemo || !endDraft || endDraft === workEnd}
                onPress={() => saveWorkEnd(endDraft)} />
            </Row>
            {dueAt !== null && !todayReflection && !reflectionDue && <Hint>{clock(dueAt)}ごろに振り返りを通知します</Hint>}
          </Card>
  </>;
  const aiBlock = <>
          <Card title="AI提案">
            <Label>使える時間</Label>
            <Row>
              <View style={s.minutesInput}><Input label="使える時間（分）" hideLabel value={available} set={setAvailableAndReset} numeric placeholder="分" disabled={busy} /></View>
              <Text style={ui.hint}>分</Text>
            </Row>
            {calendarLinked && <Row><Button small title={useCalendar ? "✓ 次の予定まで" : "次の予定まで"} selected={useCalendar} disabled={busy}
              onPress={() => { setUseCalendar(!useCalendar); invalidate(); }} /></Row>}

            <Label>場所</Label>
            {!!places.length && <Row>{places.map(p => <Button key={p} small title={p} disabled={busy}
              selected={currentPlace.trim() === p} onPress={() => { setCurrentPlace(currentPlace.trim() === p ? "" : p); invalidate(); }} />)}</Row>}
            <Input label="場所" hideLabel value={currentPlace} set={v => { setCurrentPlace(v); invalidate(); }} placeholder="例：自宅" disabled={busy} />

            <Button primary title={busy ? "考え中…" : "提案する"} disabled={busy || !!aiBlocked}
              onPress={() => void run(async () => {
                invalidate();
                const result = await api<Suggestions>("/recommendations", "POST", { available_minutes: integer(available), place: currentPlace.trim(), use_calendar: calendarLinked && useCalendar });
                setSuggestions(result);
              })} />
            {!!aiBlocked && <Hint>{aiBlocked}</Hint>}
            <Details title="送信先：Google Gemini">
              <Hint>タスク・調子・場所と、最近の振り返り・取り組みの記録を送信します。Googleの製品改善に使われる場合があるため、個人情報は入力しないでください。</Hint>
            </Details>
          </Card>

          {suggestions && <Card title={suggestions.source === "ai" ? "提案" : "今できるタスクはありません"}
            right={<Hint>{suggestions.available_minutes}分</Hint>}>
            {!!activity && <Hint>新しく選ぶと、今の取り組みは中断になります。</Hint>}
            {suggestions.choices.map(({ task, reason }, index) => {
              const active = activity?.kind === "task" && activity.task_id === task.id;
              return <View key={task.id} style={s.suggestion}>
                <Text style={s.taskTitle}>{index === 0 ? "おすすめ　" : ""}{task.title}　<Text style={ui.hint}>{task.minutes}分</Text></Text>
                <Text style={s.body}>{reason}</Text>
                <Button primary title={active ? "✓ 取り組み中" : `これにする（${Math.min(task.minutes, 240)}分）`} selected={active}
                  disabled={busy || isDemo || active} onPress={() => void run(() => choose(task.id, index + 1, Math.min(task.minutes, 240)))} />
              </View>;
            })}
            <View style={[s.suggestion, s.rest]}>
              <Text style={s.taskTitle}>休憩</Text>
              <Text style={s.body}>{suggestions.rest_reason}</Text>
              {activity?.kind === "rest" ? <Button title="✓ 休憩中" selected disabled onPress={() => undefined} />
                : restOpen ? <>
                  <Label>休憩時間</Label>
                  <Row>{[5, 10, 15, 30].map(value => <Button key={value} small title={`${value}分`}
                    selected={value === restDefault} disabled={busy || isDemo} onPress={() => void run(() => choose(null, null, value))} />)}
                    <Button small title="やめる" disabled={busy} onPress={() => setRestOpen(false)} /></Row>
                </> : <Button title="休む" disabled={busy || isDemo} onPress={() => setRestOpen(true)} />}
            </View>
          </Card>}

          {/* 振り返り：通知を待たずに答えたいとき・答え直したいときの入口（過去の回答は表示しない） */}
          <Card title="今日の振り返り" right={todayReflection ? <Hint>回答済み ✓</Hint> : workEnd ? <Hint>{workEnd}まで</Hint> : undefined}>
            {!showReflection && <Row><Button small title={todayReflection ? "答え直す" : "振り返る"} disabled={busy || isDemo}
              onPress={() => setReflectionOpen(true)} /></Row>}
          </Card>
  </>;
  const taskBlock = <>
          <View>
          <Card title={editingTask ? "タスクを編集" : `やること ${open.length}件`}
            right={!editingTask && !adding ? <Button small primary title="＋ 追加" disabled={busy || !connected} onPress={() => setAdding(true)} /> : undefined}>
            {(editingTask || adding) && <View style={s.formBox}>
              <TaskForm key={editingTask?.id ?? "new"} task={editingTask} groups={groups} defaultGroupId={filterGroupId}
                disabled={busy || !connected} run={run} save={value => saveTask(value, editingTask?.id ?? null)}
                cancel={editingTask ? resetForm : () => setAdding(false)} />
            </View>}
            {!tasks.length && !adding && <Hint>タスクはまだありません</Hint>}
            <Label>絞り込み</Label>
            <GroupChips groups={groups} value={groupFilter} all unclassified={tasks.some(task => task.group_id === null)}
              disabled={busy} set={setGroupFilter} />
            <TaskDonut tasks={filtered} now={now} />
            {groupFilter === "all" && groups.length > 0 ? groupSections(open.slice().sort(compare), groups)
              // 空の「未分類」は出さない（ドラッグ中だけ、未分類へ戻す落とし先として出す）。
              .filter(section => section.id !== null || section.tasks.length > 0 || !!drag).map(section =>
              <View key={String(section.id)} style={{ gap: 6 }}>
                <View ref={dropArea(`group:${section.id}`, { kind: "group", groupId: section.id, name: section.name })}
                  style={[s.dropHeader, drag?.key === `group:${section.id}` && s.dropHover]}>
                  {sectionHeading(section)}
                </View>
                {section.id !== null && collapsed.includes(section.id) ? null
                  : section.tasks.length ? section.tasks.map(task => taskRow(task, true, true)) : <Hint>タスクはありません</Hint>}
              </View>) : open.slice().sort(compare).map(task => taskRow(task, groupFilter === "all"))}
            {!!done.length && <Details title={`完了済み（${done.length}件）`}>
              {done.slice().sort(compare).map(task => taskRow(task))}
            </Details>}
            <TaskGroupPanel groups={groups} disabled={busy || !connected || isDemo} run={run} changed={refresh} />
          </Card>
          </View>
  </>;

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
      onMoveShouldSetResponderCapture={event => {
        if (dragging.current) return true;
        // マウスで押したまま少し動かしたら、その場でドラッグを始める。
        const press = pressing.current;
        if (!press || Math.abs(event.nativeEvent.pageY - press.y) < 6) return false;
        pressing.current = null;
        startDrag(press.task, event.nativeEvent.pageY);
        return !!dragging.current;
      }}
      onResponderGrant={() => { if (dragging.current) dragging.current.captured = true; }}
      onResponderMove={event => moveDrag(event.nativeEvent.pageY)}
      onResponderRelease={() => endDrag(true)}
      onResponderTerminationRequest={() => !dragging.current}
      onResponderTerminate={() => endDrag(false)}>
    <ScrollView ref={scroll} contentContainerStyle={[s.content, wide && s.wideWidth]} keyboardShouldPersistTaps="handled"
      scrollEnabled={!drag} scrollEventThrottle={16} onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }}>

      {/* ホーム：スマホでは 調子 → やること → AI提案・振り返り、広い画面では左に調子と提案、右にやること */}
      <View style={[wide ? s.columns : s.stack, hidden("now")]}>
        {wide ? <>
          <View style={[s.stack, s.column]}>{conditionBlock}{aiBlock}</View>
          <View ref={taskCard} style={[s.stack, s.column]}>{taskBlock}</View>
        </> : <>
          {conditionBlock}
          <View ref={taskCard} style={s.stack}>{taskBlock}</View>
          {aiBlock}
        </>}
      </View>

      {/* 予定：常に読み込んだままにし、連携状態をホームでも使う */}
      <View style={[s.stack, hidden("calendar")]}>
        <CalendarPanel disabled={busy || !connected} run={run} reload={calendarReload}
          changed={linked => { setCalendarLinked(linked); invalidate(); }} />
        {/* 予定を見ながらタスクも足せるようにする（一覧はホームに出る） */}
        <Card title="タスクを追加" right={<Hint>未完了 {tasks.filter(task => !task.completed).length}件</Hint>}>
          <TaskForm groups={groups} disabled={busy || !connected} run={run} save={value => saveTask(value, null)} />
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
          <Text style={ui.section}>今日の振り返り</Text>
          <Button small title={reflectionDue ? "あとで" : "閉じる"} disabled={busy} onPress={laterReflection} />
        </View>
        <Label>今日やったこと</Label>
        {log.length ? <View style={s.log}>{log.map(item => <Text key={item.id} style={s.logItem}>
          <Text style={ui.hint}>{item.time}　</Text>{item.text}</Text>)}</View>
          : <Hint>記録はありません。</Hint>}
        <Label>達成度</Label>
        <Row>{achievements.map(([key, text]) => <Button key={key} title={text} selected={achievement === key}
          disabled={busy || isDemo} onPress={() => setAchievement(key)} />)}</Row>
        <Label>AI提案の満足度</Label>
        <Stars value={satisfaction} set={setSatisfaction} disabled={busy || isDemo} />
        <Label>疲れ具合</Label>
        <Row>{conditions.map(([key, text]) => <Button key={key} small title={text} selected={tiredness === key}
          disabled={busy || isDemo} onPress={() => setTiredness(key)} />)}</Row>
        <TextInput accessibilityLabel="コメント" style={ui.input} value={comment} onChangeText={setComment} editable={!busy && !isDemo}
          placeholder="コメント（任意）" placeholderTextColor="#64748b" maxLength={200} multiline />
        <Button primary title={todayReflection ? "更新" : "保存"} disabled={busy || !connected || isDemo}
          onPress={() => void run(saveReflection)} />
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      </ScrollView>
    </Animated.View>}
  </SafeAreaView></SafeAreaProvider>;
}

// 隠しているグループの保存先（Webのみ。アプリでは開き直すとすべて表示に戻る）。
const collapsedKey = (username: string) => `ictsol-collapsed-groups:${username}`;
function loadCollapsed(username: string): number[] {
  try {
    const saved = Platform.OS === "web" ? globalThis.localStorage?.getItem(collapsedKey(username)) : null;
    const value: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];
  } catch { return []; }
}
function saveCollapsed(username: string, ids: number[]) {
  try { if (Platform.OS === "web") globalThis.localStorage?.setItem(collapsedKey(username), JSON.stringify(ids)); } catch { /* 保存できなくても表示は切り替える */ }
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
  rowLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.primary },
  checkMark: { color: "white", fontSize: 11, fontWeight: "700", lineHeight: 13 },
  more: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  moreOn: { backgroundColor: colors.soft },
  moreText: { fontSize: 20, color: colors.muted, fontWeight: "700", lineHeight: 22 },
  taskTitle: { fontSize: 16, color: "#243e33", fontWeight: "600" }, done: { textDecorationLine: "line-through", color: "#738179" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  minutesInput: { width: 90 },
  badge: { fontSize: 11, fontWeight: "700", color: colors.primary, backgroundColor: colors.soft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  due: { fontSize: 12, fontWeight: "700", color: colors.text, backgroundColor: colors.line, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  dueSoon: { color: "#8a4b00", backgroundColor: "#fdecc8" },
  dueOver: { color: "#9a2920", backgroundColor: "#fde2dd" },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
  suggestion: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 10 },
  rest: { backgroundColor: "#f4f1ea" },
  scrollBox: { flex: 1 },
  picker: { gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  nameInput: { flex: 1, minWidth: 160 },
  dropHover: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.soft, borderRadius: 10 },
  dragging: { opacity: 0.4 },
  dropHeader: { paddingVertical: 4, paddingHorizontal: 4 },
  link: { fontSize: 12, color: colors.muted, fontWeight: "600", paddingHorizontal: 4 },
  // 入力欄の中のボタン（薄い面）が背景に溶けないよう、白地に枠線で囲む。
  formBox: { padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  tag: { fontSize: 12, color: colors.muted, backgroundColor: colors.line, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: "hidden" },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headingToggle: { flex: 1, minHeight: 36, justifyContent: "center" },
  ghost: { position: "absolute", top: 0, left: 16, right: 16, padding: 12, gap: 2, borderRadius: 12, backgroundColor: "white", opacity: 0.95,
    borderWidth: 2, borderColor: colors.primary, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  ghostLabel: { fontSize: 13, fontWeight: "700", color: colors.primary },
  undo: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, paddingLeft: 12, backgroundColor: "#deeee4", borderRadius: 10 },
  undoText: { flex: 1, color: "#234e3d" },
  log: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: colors.soft },
  logItem: { fontSize: 14, lineHeight: 21, color: colors.text },
});
