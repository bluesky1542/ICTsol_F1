import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Level, Task, TaskGroup } from "./api";
import { GroupChips } from "./TaskGroupPanel";
import { Button, Input, Label, Row, TimeField, s as ui } from "./ui";

// サーバーへ送るタスクの中身（追加・編集で共通）。
export type TaskPayload = {
  title: string; minutes: number; deadline: string | null; priority: Level;
  concentration: Level; place: string; group_id: number | null;
};
const levels: [Level, string][] = [["low", "低"], ["medium", "中"], ["high", "高"]];

// 入力値を確かめて送信用の形にする。正しくなければ日本語のエラーを投げる。
function payload(form: { title: string; minutes: string; date: string; time: string; priority: Level; concentration: Level; place: string; groupId: number | null }): TaskPayload {
  if (!form.title.trim()) throw new Error("タスク名を入力してください。");
  if (!/^\d+$/.test(form.minutes) || Number(form.minutes) < 1 || Number(form.minutes) > 1440) throw new Error("時間は1〜1440分で入力してください。");
  const date = form.date.trim(), time = form.time.trim();
  if (time && !date) throw new Error("締切の日付も入力してください。");
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    throw new Error("締切の日付が正しくありません。");
  }
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("締切の時刻が正しくありません。");
  return { title: form.title.trim(), minutes: Number(form.minutes), deadline: date ? (time ? `${date}T${time}` : date) : null,
    priority: form.priority, concentration: form.concentration, place: form.place.trim(), group_id: form.groupId };
}

// タスクの追加・編集フォーム。ホームの「やること」とカレンダータブで使う。
// 編集するタスクを変えるときは key を変えて作り直す。
export default function TaskForm({ task, groups, defaultGroupId = null, initialDate = "", disabled, run, save, cancel }: {
  task?: Task | null; groups: TaskGroup[]; defaultGroupId?: number | null; initialDate?: string; disabled: boolean;
  run: (work: () => Promise<void>) => Promise<void>; save: (value: TaskPayload) => Promise<void>; cancel?: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [minutes, setMinutes] = useState(String(task?.minutes ?? 20));
  const [date, setDate] = useState(task ? task.deadline?.slice(0, 10) ?? "" : initialDate);
  const [time, setTime] = useState(task?.deadline?.slice(11, 16) ?? "");
  const [priority, setPriority] = useState<Level>(task?.priority ?? "medium");
  const [concentration, setConcentration] = useState<Level>(task?.concentration ?? "medium");
  const [place, setPlace] = useState(task?.place ?? "");
  const [groupId, setGroupId] = useState<number | null>(task ? task.group_id : defaultGroupId);
  // 追加のときは、絞り込み中のグループ・選んだ日付に合わせる。
  useEffect(() => { if (!task) setGroupId(defaultGroupId); }, [defaultGroupId]);
  useEffect(() => { if (!task) setDate(initialDate); }, [initialDate]);
  // 消されたグループを選んだままにしない。
  useEffect(() => { if (groupId !== null && !groups.some(group => group.id === groupId)) setGroupId(null); }, [groups]);
  function reset() {
    setTitle(""); setMinutes("20"); setDate(initialDate); setTime(""); setPriority("medium"); setConcentration("medium"); setPlace("");
    setGroupId(defaultGroupId);
  }
  return <View style={s.form}>
    {/* 「未分類」ボタンは置かない。何も選ばなければ未分類で、選んだグループをもう一度押すと外せる */}
    {!!groups.length && <>
      <Label>グループ</Label>
      <GroupChips groups={groups} value={groupId} disabled={disabled} unclassified={false}
        set={value => setGroupId(value === "all" || value === groupId ? null : value)} />
    </>}
    <Input label="タスク名" hideLabel value={title} set={setTitle} placeholder="タスク名" disabled={disabled} />
    <Label>かかる時間</Label>
    <Row>
      <View style={s.minutesInput}><Input label="かかる時間（分）" hideLabel value={minutes} set={setMinutes} numeric placeholder="分" disabled={disabled} /></View>
      <Text style={ui.hint}>分</Text>
    </Row>
    <Label>締切</Label>
    <Row>
      <TimeField kind="date" label="締切の日付" value={date} set={setDate} disabled={disabled} />
      <TimeField label="締切の時刻" value={time} set={setTime} disabled={disabled} />
      {!!(date || time) && <Button small title="消す" label="締切を消す" disabled={disabled}
        onPress={() => { setDate(""); setTime(""); }} />}
    </Row>
    <Label>優先度</Label><Row>{levels.map(([key, text]) => <Button key={key} small title={text}
      selected={priority === key} disabled={disabled} onPress={() => setPriority(key)} />)}</Row>
    <Label>集中度</Label><Row>{levels.map(([key, text]) => <Button key={key} small title={text}
      selected={concentration === key} disabled={disabled} onPress={() => setConcentration(key)} />)}</Row>
    <Input label="場所" value={place} set={setPlace} placeholder="例：自宅" disabled={disabled} />
    <Row>
      <Button primary title={task ? "保存" : "追加"} disabled={disabled} onPress={() => void run(async () => {
        await save(payload({ title, minutes, date, time, priority, concentration, place, groupId }));
        if (!task) reset();
      })} />
      {cancel && <Button title="やめる" disabled={disabled} onPress={cancel} />}
    </Row>
  </View>;
}

const s = StyleSheet.create({
  form: { gap: 12 },
  minutesInput: { width: 90 },
});
