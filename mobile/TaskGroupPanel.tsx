import { useState } from "react";
import { View } from "react-native";
import { api, TaskGroup } from "./api";
import type { GroupFilter } from "./taskGroups";
import { Button, Details, Input, Row } from "./ui";

export function GroupChips({ groups, value, set, disabled, all = false, unclassified = true }: {
  groups: TaskGroup[]; value: GroupFilter; set: (value: GroupFilter) => void; disabled: boolean;
  all?: boolean; unclassified?: boolean;
}) {
  const choices: { id: GroupFilter; name: string }[] = [
    ...(all ? [{ id: "all" as const, name: "すべて" }] : []),
    ...(!all && unclassified ? [{ id: null, name: "未分類" }] : []),
    ...groups,
    ...(all && unclassified ? [{ id: null, name: "未分類" }] : []),
  ];
  return <Row>{choices.map(group => <View key={String(group.id)} style={{ maxWidth: "100%" }}>
    <Button small title={group.name} selected={value === group.id} disabled={disabled} onPress={() => set(group.id)} />
  </View>)}</Row>;
}

export default function TaskGroupPanel({ groups, disabled, run, changed }: {
  groups: TaskGroup[]; disabled: boolean; run: (work: () => Promise<void>) => Promise<void>; changed: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  async function save(groupId: number | null, text: string) {
    if (!text.trim()) throw new Error("グループ名を入力してください。");
    await api(groupId === null ? "/groups" : `/groups/${groupId}`, groupId === null ? "POST" : "PUT", { name: text.trim() });
    await changed(); setName(""); setEditing(null);
  }
  return <Details title="グループを管理">
    <Input label="新しいグループ名" value={name} set={setName} disabled={disabled} maxLength={30} />
    <Row><Button small title="作成" disabled={disabled || groups.length >= 30} onPress={() => void run(() => save(null, name))} /></Row>
    {groups.map(group => <View key={group.id} style={{ gap: 8 }}>
      {editing === group.id ? <>
        <Input label="新しい名前" value={draft} set={setDraft} disabled={disabled} maxLength={30} />
        <Row><Button small title="保存" disabled={disabled} onPress={() => void run(() => save(group.id, draft))} />
          <Button small title="やめる" disabled={disabled} onPress={() => setEditing(null)} /></Row>
      </> : <Row>
        <View style={{ maxWidth: "100%" }}><Button small title={group.name} label={`${group.name}の名前を変更`} disabled={disabled}
          onPress={() => { setEditing(group.id); setDraft(group.name); setConfirmDelete(null); }} /></View>
        <Button small title={confirmDelete === group.id ? "本当に削除" : "削除"} label={`${group.name}を${confirmDelete === group.id ? "本当に削除" : "削除"}`}
          disabled={disabled} onPress={() => confirmDelete === group.id ? void run(async () => {
            await api(`/groups/${group.id}`, "DELETE"); await changed(); setConfirmDelete(null);
          }) : setConfirmDelete(group.id)} />
        {confirmDelete === group.id && <Button small title="やめる" disabled={disabled} onPress={() => setConfirmDelete(null)} />}
      </Row>}
    </View>)}
  </Details>;
}
