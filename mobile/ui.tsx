import { createElement, ReactNode, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// 画面全体で使う色。既存の緑系の配色に合わせる。
export const colors = {
  // 緑は差し色だけに使い、文字や線は緑みの少ないグレーにして単調さを減らす。
  background: "#f3f5f4", ink: "#1c2623", text: "#3a4541", muted: "#6b7672",
  primary: "#24654c", border: "#d5ddd9", soft: "#edf3f0", line: "#e9edeb", taskOpen: "#cfdcd6",
};

export function Button({ title, onPress, disabled = false, selected = false, primary = false, small = false, label }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean; primary?: boolean; small?: boolean; label?: string;
}) {
  const filled = selected || primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    onPress={onPress} disabled={disabled}
    style={[s.button, small && s.small, primary && s.primary, filled && s.filled, disabled && s.disabled]}>
    <Text style={[s.buttonText, primary && s.primaryText, filled && s.filledText]}>{title}</Text>
  </Pressable>;
}

export function Input({ label, value, set, numeric = false, placeholder = "", disabled = false, hideLabel = false, maxLength, autoFocus = false, submit }: {
  label: string; value: string; set: (text: string) => void; numeric?: boolean; placeholder?: string;
  disabled?: boolean; hideLabel?: boolean; maxLength?: number;
  // 表示したらすぐ入力できるようにする。submit はキーボードの決定（Enter）で呼ぶ。
  autoFocus?: boolean; submit?: () => void;
}) {
  return <View style={s.field}>{!hideLabel && <Text style={s.label}>{label}</Text>}<TextInput accessibilityLabel={label}
    style={s.input} value={value} onChangeText={set} editable={!disabled} keyboardType={numeric ? "number-pad" : "default"}
    placeholder={placeholder} placeholderTextColor="#64748b" maxLength={maxLength ?? (numeric ? 4 : 120)}
    autoFocus={autoFocus} onSubmitEditing={submit} /></View>;
}

// 日付（YYYY-MM-DD）・時刻（HH:MM）の入力欄。Webではブラウザの選択画面を使い、アプリでは文字で入力する。
export function TimeField({ label, value, set, disabled = false, kind = "time" }: {
  label: string; value: string; set: (text: string) => void; disabled?: boolean; kind?: "time" | "date";
}) {
  if (Platform.OS === "web") return createElement("input", {
    type: kind, "aria-label": label, value, disabled,
    onChange: (event: { target: { value: string } }) => set(event.target.value),
    style: { font: "inherit", fontSize: 16, padding: 10, borderRadius: 9, border: `1px solid ${colors.border}`,
      color: colors.ink, backgroundColor: "#fafcfb", minHeight: 44, boxSizing: "border-box", opacity: disabled ? 0.45 : 1 },
  });
  return <TextInput accessibilityLabel={label} style={[s.input, { width: kind === "date" ? 140 : 100 }]} value={value} onChangeText={set}
    editable={!disabled} placeholder={kind === "date" ? "2026-11-05" : "18:30"} placeholderTextColor="#64748b"
    maxLength={kind === "date" ? 10 : 5} keyboardType="numbers-and-punctuation" />;
}

export function Card({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return <View style={s.card}>
    {(title || right) && <View style={s.cardHeading}>{!!title && <Text style={s.section}>{title}</Text>}{right}</View>}
    {children}
  </View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Hint({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return <Text style={[s.hint, warn && s.warn]}>{children}</Text>;
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

// 補足説明は普段は閉じておき、必要なときだけ開いて読めるようにする。
export function Details({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded(!expanded);
  return <View style={s.details}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={toggle} style={s.detailsToggle}>
      <Text style={s.detailsTitle}>{expanded ? "▾" : "▸"} {title}</Text>
    </Pressable>
    {expanded && <View style={s.detailsBody}>{children}</View>}
  </View>;
}

export function Tabs<T extends string>({ tabs, value, set }: { tabs: [T, string][]; value: T; set: (tab: T) => void }) {
  return <View accessibilityRole="tablist" style={s.tabs}>{tabs.map(([key, text]) => {
    const active = key === value;
    return <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => set(key)}
      style={[s.tab, active && s.tabActive]}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{text}</Text>
    </Pressable>;
  })}</View>;
}

export function Stars({ value, set, disabled = false }: { value: number | null; set: (value: number) => void; disabled?: boolean }) {
  return <View style={s.row}>{[1, 2, 3, 4, 5].map(n => <Pressable key={n} accessibilityRole="button"
    accessibilityLabel={`${n}点`} accessibilityState={{ selected: value === n, disabled }} disabled={disabled}
    onPress={() => set(n)} style={[s.star, disabled && s.disabled]}>
    <Text style={[s.starText, value !== null && n <= value && s.starOn]}>{value !== null && n <= value ? "★" : "☆"}</Text>
  </Pressable>)}</View>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: "white", padding: 16, borderRadius: 14, gap: 12 },
  cardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  section: { fontSize: 17, fontWeight: "700", color: colors.ink },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  field: { gap: 6 }, label: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 11, fontSize: 16, color: colors.ink, backgroundColor: "white" },
  // 普段のボタンは枠線なしの薄い面にして、画面の線を減らす。
  button: { minHeight: 42, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", alignItems: "center", backgroundColor: colors.soft },
  small: { paddingHorizontal: 10 },
  primary: { minHeight: 46, paddingHorizontal: 18 },
  filled: { backgroundColor: colors.primary },
  buttonText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  primaryText: { fontSize: 15 }, filledText: { color: "white" },
  disabled: { opacity: 0.45 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 }, warn: { color: "#9a2920" },
  details: { gap: 6 },
  detailsToggle: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" },
  detailsTitle: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  // 中にボタン（薄い面）が入ることがあるので、白地に枠線で囲む。
  detailsBody: { gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" },
  tabs: { flexDirection: "row", backgroundColor: colors.line, borderRadius: 12, padding: 3, gap: 3 },
  tab: { flex: 1, minHeight: 38, borderRadius: 9, justifyContent: "center", alignItems: "center" },
  tabActive: { backgroundColor: "white" },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.muted }, tabTextActive: { color: colors.ink },
  star: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  starText: { fontSize: 28, color: colors.border }, starOn: { color: "#e0a526" },
});
