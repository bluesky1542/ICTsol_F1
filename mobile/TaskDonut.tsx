import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Task } from "./api";
import { taskStats } from "./taskStats";
import { Card, colors, Hint } from "./ui";

export default function TaskDonut({ tasks, now }: { tasks: Task[]; now: number }) {
  const { total, done, open, overdue, rate } = taskStats(tasks, now);
  const circumference = 2 * Math.PI * 75;
  const completed = total ? circumference * (done / total) : 0;
  const gap = done && open ? Math.min(2, completed / 2, (circumference - completed) / 2) : 0;
  const doneLength = Math.max(0, completed - gap), openLength = Math.max(0, circumference - completed - gap);
  return <Card title="タスクの達成状況">
    {total === 0 ? <Hint>まだタスクがありません。ホームの「やること」から追加しましょう。</Hint> : <>
      <View accessible accessibilityRole="image" accessibilityLabel={`完了 ${done}件、未完了 ${open}件、完了率 ${rate}%`} style={s.chart}>
        <Svg width="100%" height="100%" viewBox="0 0 180 180">
          <Circle cx={90} cy={90} r={75} fill="none" stroke={colors.primary} strokeWidth={30}
            strokeDasharray={[doneLength, circumference - doneLength]}
            strokeDashoffset={-gap / 2} transform="rotate(-90 90 90)" />
          <Circle cx={90} cy={90} r={75} fill="none" stroke={colors.taskOpen} strokeWidth={30}
            strokeDasharray={[openLength, circumference - openLength]}
            strokeDashoffset={-completed - gap / 2} transform="rotate(-90 90 90)" />
        </Svg>
        <View pointerEvents="none" style={s.center}>
          <Text style={s.rate}>{rate}%</Text>
          <Text style={s.count}>{done} / {total}件 完了</Text>
        </View>
      </View>
      <View style={s.legend}>
        <View style={s.entry}><View style={[s.swatch, { backgroundColor: colors.primary }]} /><Text style={s.text}>完了 {done}件（{rate}%）</Text></View>
        <View style={s.entry}><View style={[s.swatch, { backgroundColor: colors.taskOpen }]} /><Text style={s.text}>未完了 {open}件（{100 - rate}%）</Text></View>
      </View>
      {overdue > 0 && <Hint warn>未完了のうち 締切切れ {overdue}件</Hint>}
    </>}
  </Card>;
}

const s = StyleSheet.create({
  chart: { width: 180, maxWidth: "100%", aspectRatio: 1, alignSelf: "center" },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  rate: { fontSize: 34, fontWeight: "700", color: colors.ink },
  count: { fontSize: 12, color: colors.muted },
  legend: { alignSelf: "center", gap: 10 },
  entry: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  text: { fontSize: 14, color: colors.ink, flexShrink: 1 },
});
