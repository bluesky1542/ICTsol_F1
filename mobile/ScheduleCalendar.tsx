import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarSnapshot, dayIsCovered, dayKey, eventsForDay, eventTime, monthDays } from "./calendarView";

const weekdays = ["月", "火", "水", "木", "金", "土", "日"];

function Control({ title, label, onPress }: { title: string; label?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} style={s.control}>
    <Text style={s.controlText}>{title}</Text>
  </Pressable>;
}

export default function ScheduleCalendar({ snapshot }: { snapshot: CalendarSnapshot }) {
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const today = dayKey(new Date());
  const selectedKey = dayKey(selected);
  const dates = useMemo(() => monthDays(month).map(day => ({ day, count: eventsForDay(snapshot.events, day).length })), [month, snapshot.events]);
  const entries = useMemo(() => eventsForDay(snapshot.events, selected), [snapshot.events, selected]);
  const covered = dayIsCovered(snapshot.sync, selected);
  function moveMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next); setSelected(next);
  }
  function chooseDate(day: Date) {
    setSelected(day);
    if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  return <View style={s.calendar}>
    <Text style={s.heading}>自分の予定</Text>
    <View style={s.toolbar}>
      <Control title="‹" label="前の月" onPress={() => moveMonth(-1)} />
      <Text accessibilityLiveRegion="polite" style={s.month}>{month.getFullYear()}年{month.getMonth() + 1}月</Text>
      <Control title="›" label="次の月" onPress={() => moveMonth(1)} />
      <Control title="今日" onPress={() => chooseDate(new Date())} />
    </View>
    <Text style={s.caption}>端末の現地時刻で表示 · 日付を押すと予定を確認できます</Text>
    <View style={s.week}>{weekdays.map((name, index) => <View key={name} style={s.weekCell}>
      <Text style={[s.weekday, index === 5 && s.saturday, index === 6 && s.sunday]}>{name}</Text>
    </View>)}</View>
    {Array.from({ length: 6 }, (_, week) => <View key={week} style={s.week}>
      {dates.slice(week * 7, week * 7 + 7).map(({ day, count }) => {
        const key = dayKey(day);
        const isSelected = key === selectedKey, isToday = key === today;
        return <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日${isToday ? "、今日" : ""}、保存済みの予定${count}件`}
          onPress={() => chooseDate(day)} style={[s.day, day.getMonth() !== month.getMonth() && s.otherMonth, isToday && s.today, isSelected && s.selected]}>
          <Text style={[s.dayNumber, isSelected && s.selectedText]}>{day.getDate()}</Text>
          <View style={s.markerSpace}>{count > 0 && <Text style={[s.markerCount, isSelected && s.selectedText]}>● {count > 99 ? "99+" : count}</Text>}</View>
        </Pressable>;
      })}
    </View>)}
    <Text style={s.caption}>● 保存済みの予定の件数 · 追加・端末取り込みの対象は今後7日間です</Text>
    {snapshot.sync?.source === "imported" && <Text style={s.caption}>取り込み範囲：{new Date(snapshot.sync.window_start).toLocaleString("ja-JP")} 〜 {new Date(snapshot.sync.window_end).toLocaleString("ja-JP")}</Text>}
    <View style={s.agenda}>
      <View style={s.agendaHeading}><Text style={s.heading}>{selected.getMonth() + 1}月{selected.getDate()}日（{weekdays[(selected.getDay() + 6) % 7]}）</Text>
        <Text style={s.caption}>{entries.length}件</Text></View>
      {!snapshot.sync ? <Text style={s.caption}>まだ予定を読み込んでいません。下から予定時間を追加するか、端末のカレンダーを取り込んでください。</Text>
        : (!covered || snapshot.sync.source === "manual") && <Text style={s.caption}>{snapshot.sync.source === "imported" ? "この日は取り込み範囲の一部または範囲外です。予定がすべて表示されているとは限りません。" : "手入力で保存した予定だけを表示しています。"}</Text>}
      {!entries.length && <Text style={s.empty}>{covered && snapshot.sync?.source === "imported" ? "取り込み済みの予定はありません。" : "保存済みの予定はありません。"}</Text>}
      {entries.map(event => <View key={event.event_key} style={s.eventRow}>
        <View style={s.rail}><View style={s.eventDot} /><View style={s.eventLine} /></View>
        <View style={s.event}>
          <Text style={s.eventTime}>{eventTime(event, selected)}</Text>
          <Text style={s.eventTitle}>予定あり</Text>
          {(event.continuesBefore || event.continuesAfter) && <Text style={s.caption}>{[event.continuesBefore && "前日から続く予定", event.continuesAfter && "翌日へ続く予定"].filter(Boolean).join(" · ")}</Text>}
        </View>
      </View>)}
    </View>
    <Text style={s.caption}>予定名は保存していないため、時間帯を「予定あり」と表示します。Googleカレンダーの予定を自動取得する機能ではありません。</Text>
  </View>;
}

const s = StyleSheet.create({
  calendar: { gap: 12 }, heading: { fontSize: 17, fontWeight: "700", color: "#183c32" },
  toolbar: { flexDirection: "row", gap: 8, alignItems: "center" }, month: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: "#183c32" },
  control: { minWidth: 44, minHeight: 44, borderRadius: 10, backgroundColor: "#eef6f1", justifyContent: "center", alignItems: "center", paddingHorizontal: 10 },
  controlText: { fontSize: 17, color: "#234e3d", fontWeight: "600" }, caption: { fontSize: 12, lineHeight: 19, color: "#52645e" },
  week: { flexDirection: "row", gap: 2 }, weekCell: { flex: 1, alignItems: "center" }, weekday: { fontSize: 12, color: "#52645e", fontWeight: "600" },
  saturday: { color: "#3567a1" }, sunday: { color: "#ab4545" },
  day: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: "transparent", borderRadius: 9, alignItems: "center", justifyContent: "center" },
  otherMonth: { opacity: 0.4 }, today: { borderColor: "#24654c" }, selected: { backgroundColor: "#24654c", opacity: 1 },
  dayNumber: { fontSize: 14, color: "#243e33", fontWeight: "600" }, selectedText: { color: "white" },
  markerSpace: { height: 13, justifyContent: "flex-end" }, markerCount: { fontSize: 9, color: "#24654c" },
  agenda: { gap: 12, borderTopWidth: 1, borderColor: "#e5ece8", paddingTop: 16 }, agendaHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  empty: { paddingVertical: 14, color: "#52645e", fontSize: 14 }, eventRow: { flexDirection: "row", gap: 10 },
  rail: { width: 10, alignItems: "center", paddingTop: 16 }, eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#24654c" },
  eventLine: { flex: 1, width: 2, backgroundColor: "#deeee4", marginTop: 4 },
  event: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#eef6f1", gap: 5 }, eventTime: { color: "#234e3d", fontWeight: "700", fontSize: 14 },
  eventTitle: { color: "#344d43", fontSize: 14 },
});
