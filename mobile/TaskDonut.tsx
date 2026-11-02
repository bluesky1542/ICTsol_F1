import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { Task } from "./api";
import { taskStats } from "./taskStats";
import { colors, Hint } from "./ui";

export default function TaskDonut({ tasks, now }: { tasks: Task[]; now: number }) {
  const { total, done, open, overdue, rate } = taskStats(tasks, now);
  if (total === 0) return null;
  const circumference = 2 * Math.PI * 30;
  const completed = circumference * (done / total);
  const gap = done && open ? Math.min(2, completed / 2, (circumference - completed) / 2) : 0;
  const doneLength = Math.max(0, completed - gap), openLength = Math.max(0, circumference - completed - gap);
  return <View style={s.summary}>
    <View accessible accessibilityRole="image" accessibilityLabel={`完了 ${done}件、未完了 ${open}件、完了率 ${rate}%`} style={s.chart}>
      <Svg width="100%" height="100%" viewBox="0 0 72 72">
        <Circle cx={36} cy={36} r={30} fill="none" stroke={colors.primary} strokeWidth={12}
          strokeDasharray={[doneLength, circumference - doneLength]}
          strokeDashoffset={-gap / 2} transform="rotate(-90 36 36)" />
        <Circle cx={36} cy={36} r={30} fill="none" stroke={colors.taskOpen} strokeWidth={12}
          strokeDasharray={[openLength, circumference - openLength]}
          strokeDashoffset={-completed - gap / 2} transform="rotate(-90 36 36)" />
      </Svg>
      <View pointerEvents="none" style={s.center}>
        <Text style={s.rate}>{rate}%</Text>
      </View>
    </View>
    <View style={s.legend}>
      <View style={s.entry}><View style={[s.swatch, { backgroundColor: colors.primary }]} /><Text style={s.text}>完了 {done}件（{rate}%）</Text></View>
      <View style={s.entry}><View style={[s.swatch, { backgroundColor: colors.taskOpen }]} /><Text style={s.text}>未完了 {open}件（{100 - rate}%）</Text></View>
      {overdue > 0 && <Hint warn>未完了のうち 締切切れ {overdue}件</Hint>}
    </View>
  </View>;
}

const s = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line },
  chart: { width: 72, height: 72, flexShrink: 0 },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  rate: { fontSize: 16, fontWeight: "700", color: colors.ink },
  legend: { flex: 1, minWidth: 0, gap: 4 },
  entry: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 2, flexShrink: 0 },
  text: { fontSize: 14, color: colors.ink, flexShrink: 1 },
});
