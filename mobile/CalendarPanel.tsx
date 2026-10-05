import { useEffect, useState } from "react";
import { Button, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "./api";

type Snapshot = { sync: { synced_at: string; window_start: string; window_end: string; source: "manual" | "imported" } | null; events: { event_key: string; starts_at: string; ends_at: string }[] };
type Props = { disabled: boolean; run: (work: () => Promise<void>) => Promise<void>; changed: (linked: boolean) => void };
export default function CalendarPanel({ disabled, run, changed }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ sync: null, events: [] });
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loadError, setLoadError] = useState("");
  function update(value: Snapshot) { setSnapshot(value); changed(!!value.sync); }
  useEffect(() => {
    let active = true;
    api<Snapshot>("/calendar").then(value => { if (active) update(value); }).catch(() => { if (active) setLoadError("予定を取得できませんでした。再読み込みしてください。"); });
    return () => { active = false; };
  }, []);
  async function discover() {
    const Calendar = await import("expo-calendar");
    let permission;
    try { permission = await Calendar.requestCalendarPermissions(); }
    catch { throw new Error("端末カレンダーはExpo Goでは利用できません。開発ビルドで起動してください。"); }
    if (!permission.granted) throw new Error("カレンダーの読み取りが許可されていません。端末設定で許可するか、予定を手入力してください。");
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
    const parse = (text: string) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) throw new Error("日時は YYYY-MM-DDTHH:mm で入力してください。");
      const value = new Date(text);
      if (Number.isNaN(value.getTime())) throw new Error("日時が不正です。");
      const [year, month, day, hour, minute] = text.split(/[-T:]/).map(Number);
      if (value.getFullYear() !== year || value.getMonth() + 1 !== month || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) throw new Error("実在する日時を入力してください。");
      return value;
    };
    const from = new Date(), until = new Date(from.getTime() + 7 * 86400000);
    const begins = parse(start), ends = parse(end);
    if (ends <= begins || ends <= from || begins >= until) throw new Error("これから7日間にかかる予定で、終了を開始より後にしてください。");
    update(await api<Snapshot>("/calendar/manual", "POST", { starts_at: begins.toISOString(), ends_at: ends.toISOString() })); setStart(""); setEnd("");
  }
  return <View style={s.card}><Text style={s.heading}>カレンダー・予定</Text>
    {!!loadError && <Text accessibilityRole="alert">{loadError}</Text>}
    <Button title="保存済み予定を再読み込み" disabled={disabled} onPress={() => void run(async () => { update(await api<Snapshot>("/calendar")); setLoadError(""); })} />
    <Text>選択した予定の開始・終了時刻のみサーバーへ送信します。タイトル・説明・参加者は送信しません。取り込みはボタン操作時のみです。</Text>
    {Platform.OS !== "web" ? <Button title="端末のカレンダーを選ぶ" disabled={disabled} onPress={() => void run(discover)} /> : <Text>Webでは端末カレンダーを読めないため、下で予定を手入力できます。</Text>}
    {calendars.map(c => <Button key={c.id} title={`${selected.includes(c.id) ? "✓ " : ""}${c.title}`} disabled={disabled} onPress={() => setSelected(v => v.includes(c.id) ? v.filter(id => id !== c.id) : [...v, c.id])} />)}
    {!!calendars.length && <><Text>取り込むと、このアカウントの保存済み予定（手入力も含む）を選択カレンダーの今後7日分で置き換えます。終日の予定は終日を予定ありとして扱います。</Text>
      <Button title="選択した予定を取り込む" disabled={disabled || !selected.length} onPress={() => void run(sync)} /></>}
    <Text>手入力（端末の現地時刻）</Text>
    <TextInput accessibilityLabel="予定の開始日時" placeholder="2026-10-05T14:00" value={start} onChangeText={setStart} editable={!disabled} style={s.input} />
    <TextInput accessibilityLabel="予定の終了日時" placeholder="2026-10-05T15:00" value={end} onChangeText={setEnd} editable={!disabled} style={s.input} />
    <Button title="予定時間を追加" disabled={disabled} onPress={() => void run(manual)} />
    <Text>{snapshot.sync ? `更新：${new Date(snapshot.sync.synced_at).toLocaleString("ja-JP")} · ${snapshot.events.length}件` : "予定は未連携です。"}</Text>
    {snapshot.sync?.source === "manual" && <Text>手入力の予定は翌日以降も使えます。24時間ごとの再取り込みは不要です。</Text>}
    {snapshot.events.slice(0, 20).map(e => <Text key={e.event_key}>{new Date(e.starts_at).toLocaleString("ja-JP")} 〜 {new Date(e.ends_at).toLocaleString("ja-JP")}</Text>)}
    {snapshot.events.length > 20 && <Text>ほか {snapshot.events.length - 20}件</Text>}
    {!!snapshot.sync && <Button title="連携解除（サーバーの予定時間を削除）" disabled={disabled} onPress={() => void run(async () => {
      await api("/calendar", "DELETE"); update({ sync: null, events: [] }); setSelected([]); setCalendars([]);
    })} />}
  </View>;
}
const s = StyleSheet.create({ card: { backgroundColor: "white", padding: 20, borderRadius: 18, gap: 14 }, heading: { fontSize: 20, fontWeight: "700", color: "#183c32" }, input: { borderWidth: 1, borderColor: "#bdcec7", borderRadius: 8, padding: 12, fontSize: 16 } });
