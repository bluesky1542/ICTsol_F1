import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Activity, ActivityAction } from "./api";
import { formatDuration } from "./activityLog";
import { Button, Card, colors, Hint, Row } from "./ui";

// 取り組み中のタスク（または休憩）の残り時間を数え、終わったら結果を記録してもらうカード。
export default function FocusCard({ activity, disabled, act }: {
  activity: Activity; disabled: boolean; act: (action: ActivityAction, minutes?: number) => void;
}) {
  const [now, setNow] = useState(Date.now());
  // 「途中まで」を押したあとの「続ける／ここでやめる」の選択中か。
  const [partial, setPartial] = useState(false);
  // 表示中だけ1秒ごとに数え直す（画面全体の30秒更新とは別にする）。
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setPartial(false); }, [activity.id, activity.ends_at]);
  const rest = activity.kind === "rest";
  const left = Date.parse(activity.ends_at ?? activity.created_at) - now;
  const over = left <= 0;
  const name = rest ? "休憩" : activity.task_title ?? "タスク";
  return <Card title={rest ? "休憩中" : "取り組み中"} right={<Hint>予定 {activity.planned_minutes}分</Hint>}>
    <Text style={s.name}>{name}</Text>
    <View accessible accessibilityRole="timer" accessibilityLabel={over ? `予定時間を${formatDuration(left)}過ぎました` : `残り${formatDuration(left)}`}>
      <Text style={[s.time, over && s.over]}>{over ? `+${formatDuration(left)}` : formatDuration(left)}</Text>
      <Hint>{over ? "時間になりました" : "残り時間"}</Hint>
    </View>
    {partial ? <>
      <Row>
        <Button primary title="続ける（＋10分）" disabled={disabled} onPress={() => act("extend", 10)} />
        <Button title="ここでやめる" disabled={disabled} onPress={() => act("partial")} />
        <Button small title="戻る" disabled={disabled} onPress={() => setPartial(false)} />
      </Row>
    </> : <Row>
      <Button primary title={rest ? "休憩終了" : "✓ 完了"} disabled={disabled} onPress={() => act("finish")} />
      {!rest && <Button title="途中まで" disabled={disabled} onPress={() => setPartial(true)} />}
      {rest && <Button title="＋5分" disabled={disabled} onPress={() => act("extend", 5)} />}
      <Button small title="やめる" disabled={disabled} onPress={() => act("stop")} />
    </Row>}
  </Card>;
}

const s = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "700", color: colors.ink },
  time: { fontSize: 44, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  over: { color: "#8a4b00" },
});
