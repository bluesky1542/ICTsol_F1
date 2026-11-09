import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { api } from "./api";
import ScheduleCalendar from "./ScheduleCalendar";
import { parseLocalDateTime, type CalendarSnapshot } from "./calendarView";
import { Button, Card, Hint, Label, Row, s as ui } from "./ui";

type Snapshot = CalendarSnapshot;
type Props = { disabled: boolean; run: (work: () => Promise<void>) => Promise<void>; changed: (linked: boolean) => void; reload: number };
export default function CalendarPanel({ disabled, run, changed, reload }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ sync: null, events: [] });
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loadError, setLoadError] = useState("");
  // 予定の全削除は取り消せないため、2回押したときだけ実行する。
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manualMessage, setManualMessage] = useState<{ error: boolean; text: string } | null>(null);
  function update(value: Snapshot) { setSnapshot(value); changed(!!value.sync); }
  useEffect(() => {
    let active = true;
    api<Snapshot>("/calendar").then(value => { if (active) { update(value); setLoadError(""); } }).catch(() => { if (active) setLoadError("予定を取得できませんでした。↻で再読み込みしてください。"); });
    return () => { active = false; };
  }, [reload]);
  async function discover() {
    const Calendar = await import("expo-calendar");
    let permission;
    try { permission = await Calendar.requestCalendarPermissions(); }
    catch { throw new Error("Expo Goでは端末のカレンダーを使えません。開発ビルドで起動してください。"); }
    if (!permission.granted) throw new Error("カレンダーへのアクセスが許可されていません。端末の設定で許可してください。");
    const list = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    setCalendars(list.map(c => ({ id: c.id, title: c.title }))); setSelected([]);
    if (!list.length) throw new Error("読み取れるカレンダーがありません。");
  }
  async function sync() {
    const Calendar = await import("expo-calendar");
    const from = new Date(); const until = new Date(from.getTime() + 7 * 86400000);
    const events = await Calendar.listEvents(selected, from, until);
    const unique = new Map<string, { key: string; starts_at: string; ends_at: string }>();
    for (const event of events) {
      if (event.status === "canceled" || event.availability === "free") continue;
      const starts = new Date(event.startDate), ends = new Date(event.endDate);
      if (ends <= starts || ends <= from || starts >= until) continue;
      const key = `${event.id}:${starts.toISOString()}`;
      unique.set(key, { key, starts_at: starts.toISOString(), ends_at: ends.toISOString() });
    }
    update(await api<Snapshot>("/calendar", "PUT", { window_start: from.toISOString(), window_end: until.toISOString(), events: [...unique.values()] }));
  }
  async function manual() {
    const parse = (text: string, label: string) => {
      const value = parseLocalDateTime(text);
      if (!value) throw new Error(`${label}は「2026-10-20 14:00」の形で入力してください。`);
      return value;
    };
    const from = new Date(), until = new Date(from.getTime() + 7 * 86400000);
    const begins = parse(start, "開始"), ends = parse(end, "終了");
    if (ends <= begins) throw new Error("終了は開始より後にしてください。");
    if (ends <= from || begins >= until) throw new Error("追加できるのは今から7日以内の予定です。");
    update(await api<Snapshot>("/calendar/manual", "POST", { starts_at: begins.toISOString(), ends_at: ends.toISOString() })); setStart(""); setEnd("");
    setManualMessage({ error: false, text: "予定を追加しました。" });
  }
  return <Card title="予定" right={snapshot.sync ? <Hint>{snapshot.events.length}件</Hint> : undefined}>
    <ScheduleCalendar snapshot={snapshot} />
    {!!loadError && <Text accessibilityRole="alert" style={s.error}>{loadError}</Text>}

    <Label>予定を追加</Label>
    <TextInput accessibilityLabel="予定の開始日時" placeholder="開始　2026-10-20 14:00" placeholderTextColor="#64748b" value={start} onChangeText={setStart} editable={!disabled} style={ui.input} />
    <TextInput accessibilityLabel="予定の終了日時" placeholder="終了　2026-10-20 15:00" placeholderTextColor="#64748b" value={end} onChangeText={setEnd} editable={!disabled} style={ui.input} />
    {/* 入力欄のそばに結果を出し、画面上部のエラーに気づかず失敗する状態を防ぐ。 */}
    <Button primary title="追加" disabled={disabled} onPress={() => void run(async () => {
      setManualMessage(null);
      try { await manual(); }
      catch (e) { setManualMessage({ error: true, text: e instanceof Error ? e.message : "予定を追加できませんでした。" }); }
    })} />
    {manualMessage && <Text accessibilityRole={manualMessage.error ? "alert" : undefined} accessibilityLiveRegion="polite"
      style={manualMessage.error ? s.error : s.success}>{manualMessage.text}</Text>}

    {Platform.OS !== "web" && <>
      <Label>端末のカレンダーから取り込む</Label>
      <Button title="カレンダーを選ぶ" disabled={disabled} onPress={() => void run(discover)} />
      {!!calendars.length && <Row>{calendars.map(c => <Button key={c.id} small title={`${selected.includes(c.id) ? "✓ " : ""}${c.title}`} selected={selected.includes(c.id)}
        disabled={disabled} onPress={() => setSelected(v => v.includes(c.id) ? v.filter(id => id !== c.id) : [...v, c.id])} />)}</Row>}
      {!!calendars.length && <>
        <Hint warn>保存済みの予定は置き換わります。</Hint>
        <Button primary title="取り込む" disabled={disabled || !selected.length} onPress={() => void run(sync)} /></>}
    </>}

    {snapshot.sync && <Hint>最終更新：{new Date(snapshot.sync.synced_at).toLocaleString("ja-JP")}</Hint>}
    {!!snapshot.sync && <Row>
      <Button small title={confirmDelete ? "本当に削除" : "予定をすべて削除"} disabled={disabled}
        onPress={() => confirmDelete ? void run(async () => {
          await api("/calendar", "DELETE"); update({ sync: null, events: [] }); setSelected([]); setCalendars([]); setConfirmDelete(false);
        }) : setConfirmDelete(true)} />
      {confirmDelete && <Button small title="やめる" disabled={disabled} onPress={() => setConfirmDelete(false)} />}
    </Row>}
  </Card>;
}
const s = StyleSheet.create({
  error: { padding: 12, backgroundColor: "#fff0ed", color: "#9a2920", borderRadius: 10 },
  success: { padding: 12, backgroundColor: "#deeee4", color: "#234e3d", borderRadius: 10 } });
