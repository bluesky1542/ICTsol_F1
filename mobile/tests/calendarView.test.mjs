import assert from "node:assert/strict";
import test from "node:test";
import { dayBounds, dayIsCovered, dayKey, eventsForDay, eventTime, monthDays } from "../calendarView.ts";

const at = (day, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute);
const event = (key, start, end) => ({ event_key: key, starts_at: start.toISOString(), ends_at: end.toISOString() });

test("月表示は月曜始まりの42日で、年をまたいでも連続する", () => {
  for (const month of [new Date(2026, 1, 1), new Date(2026, 2, 1), new Date(2026, 11, 1), new Date(2027, 0, 1)]) {
    const days = monthDays(month);
    assert.equal(days.length, 42);
    assert.equal(days[0].getDay(), 1);
    assert.equal(days[41].getDay(), 0);
    assert.equal(new Set(days.map(dayKey)).size, 42);
    assert.ok(days.some(day => dayKey(day) === dayKey(month)));
    days.slice(1).forEach((day, index) => {
      const expected = new Date(days[index].getFullYear(), days[index].getMonth(), days[index].getDate() + 1);
      assert.equal(dayKey(day), dayKey(expected));
    });
  }
});

test("うるう年の2月29日を表示し、日付キーは端末の現地日付を使う", () => {
  assert.ok(monthDays(new Date(2028, 1, 1)).some(day => dayKey(day) === "2028-02-29"));
  assert.equal(dayKey(at(19, 0, 15)), "2026-10-19");
});

test("日付境界は半開区間で判定し、終了が0時の予定を翌日に含めない", () => {
  const overnight = event("night", at(19, 22), at(20, 0));
  assert.equal(eventsForDay([overnight], at(19)).length, 1);
  assert.equal(eventsForDay([overnight], at(20)).length, 0);
  assert.equal(eventTime(eventsForDay([overnight], at(19))[0], at(19)), "22:00〜24:00");
});

test("日またぎの予定は両日に表示し、前日と翌日への継続を識別する", () => {
  const overnight = event("night", at(19, 22), at(20, 1));
  const first = eventsForDay([overnight], at(19))[0];
  const second = eventsForDay([overnight], at(20))[0];
  assert.equal(first.continuesAfter, true);
  assert.equal(second.continuesBefore, true);
  assert.equal(eventTime(first, at(19)), "22:00〜24:00");
  assert.equal(eventTime(second, at(20)), "00:00〜01:00");
});

test("終日予定と多日予定をその日の0時から24時として表示する", () => {
  for (const entry of [event("day", at(19), at(20)), event("multi", at(18, 12), at(21, 12))]) {
    assert.equal(eventTime(eventsForDay([entry], at(19))[0], at(19)), "終日（00:00〜24:00）");
  }
});

test("重複する予定を省略せず開始順に並べる", () => {
  const entries = [event("later", at(19, 10), at(19, 12)), event("first", at(19, 9), at(19, 11)), event("overlap", at(19, 10), at(19, 11))];
  assert.deepEqual(eventsForDay(entries, at(19)).map(item => item.event_key), ["first", "overlap", "later"]);
  assert.equal(eventsForDay(entries, at(21)).length, 0);
});

test("不正な日時、逆転、長さ0の予定を読み飛ばす", () => {
  const entries = [{ event_key: "bad", starts_at: "invalid", ends_at: at(19, 12).toISOString() }, event("reverse", at(19, 12), at(19, 10)), event("zero", at(19, 12), at(19, 12))];
  assert.deepEqual(eventsForDay(entries, at(19)), []);
});

test("取得範囲がその日全体を含まない場合は予定なしと断定しない", () => {
  const sync = { window_start: at(19, 12).toISOString(), window_end: at(26, 12).toISOString() };
  assert.equal(dayIsCovered(sync, at(19)), false);
  assert.equal(dayIsCovered(sync, at(20)), true);
  assert.equal(dayIsCovered(sync, at(26)), false);
  assert.equal(dayIsCovered(null, at(20)), false);
});

test("夏時間切り替えの日も現地の翌日0時を境界とする", () => {
  for (const day of [new Date(2026, 2, 8), new Date(2026, 10, 1)]) {
    const [from, until] = dayBounds(day);
    assert.equal(from.getHours(), 0);
    assert.equal(until.getHours(), 0);
    assert.equal(dayKey(until), dayKey(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)));
    const entry = event("dst", from, until);
    assert.equal(eventTime(eventsForDay([entry], day)[0], day), "終日（00:00〜24:00）");
    assert.equal(eventsForDay([entry], until).length, 0);
  }
});
