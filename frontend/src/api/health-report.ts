import type { Bin, Comparison, Dashboard, Device, Filters, Session } from "./types";
import type { Reading } from "./health-import";
import { validDay } from "../lib/format";

const DAY = 86400;
const HOUR = 3600;
const levelBands = [70, 80, 85, 90];
const sessionBands = [300, 900, 1800, 3600, 7200];
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const dayOf = (seconds: number, offset: number) => Math.floor((seconds + offset) / DAY);
const dayLabel = (day: number) => new Date(day * DAY * 1000).toISOString().slice(0, 10);
const bandOf = (value: number, bands: number[]) => bands.filter(threshold => value >= threshold).length;

export class ReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function dateIndex(label: string) {
  if (!validDay(label)) throw new ReportError(400, "日期格式无效。");
  return Date.parse(label) / (DAY * 1000);
}

function stamp(seconds: number, offset: number) {
  const minutes = Math.abs(offset / 60);
  const two = (num: number) => String(num).padStart(2, "0");
  const zone = (offset < 0 ? "-" : "+") + two(Math.floor(minutes / 60)) + ":" + two(minutes % 60);
  return new Date((seconds + offset) * 1000).toISOString().slice(0, 19) + zone;
}

function bounds(rows: Reading[], filters: Filters, offset: number): [number, number] | null {
  const preset = filters.range ?? "all";
  let first: number;
  let last: number;
  if (filters.start !== undefined || filters.end !== undefined) {
    if (!filters.start || !filters.end || preset !== "all" || filters.as_of) {
      throw new ReportError(400, "请选择完整的起止日期。");
    }
    first = dateIndex(filters.start);
    last = dateIndex(filters.end);
  } else if (preset === "all") {
    if (filters.as_of) throw new ReportError(400, "截止日期需要搭配时间预设。");
    if (!rows.length) return null;
    first = dayOf(rows[0][4], offset);
    last = dayOf(rows.reduce((end, row) => Math.max(end, row[5]), rows[0][5]) - 1, offset);
  } else {
    last = filters.as_of ? dateIndex(filters.as_of) : dayOf(Math.floor(Date.now() / 1000), offset);
    if (preset === "1y") {
      const label = dayLabel(last);
      const year = String(Number(label.slice(0, 4)) - 1).padStart(4, "0");
      const anniversary = year + label.slice(4);
      first = dateIndex(validDay(anniversary) ? anniversary : year + "-02-28") + 1;
    } else first = last - Number(preset.slice(0, -1)) + 1;
  }
  if (first > last || last - first > 36525 || first < dateIndex("0002-01-01") ||
    last > dateIndex("9998-12-31")) throw new ReportError(400, "起止时间或日期跨度无效。");
  return [first, last];
}

class Meter {
  seconds = 0;
  energy = 0;
  bands = [0, 0, 0, 0, 0];
  add(seconds: number, level: number) {
    this.seconds += seconds;
    this.energy += seconds * 10 ** (level / 10);
    this.bands[bandOf(level, levelBands)] += seconds;
  }
  merge(other: Meter) {
    this.seconds += other.seconds;
    this.energy += other.energy;
    other.bands.forEach((value, i) => { this.bands[i] += value; });
  }
  values() {
    const above = sum(this.bands.slice(2));
    return { seconds: this.seconds,
      average_dba: this.seconds ? Number((10 * Math.log10(this.energy / this.seconds)).toFixed(2)) : null,
      at_least_80_dba_seconds: above, at_least_80_dba_ratio: this.seconds ? above / this.seconds : null };
  }
}

function changeCount<K>(counts: Map<K, number>, key: K, delta: number) {
  const next = (counts.get(key) ?? 0) + delta;
  if (next) counts.set(key, next);
  else counts.delete(key);
}

function aggregate(rows: Reading[], first: number, last: number, offset: number) {
  const low = first * DAY - offset;
  const high = (last + 1) * DAY - offset;
  const events: [number, number, number, string][] = [];
  if (last >= first) for (const [id, , , , start, end, level] of rows) {
    if (end <= low || start >= high) continue;
    events.push([Math.max(start, low), 1, level, id], [Math.min(end, high), -1, level, id]);
  }
  events.sort((a, b) => a[0] - b[0]);
  const activeLevels = new Map<number, number>();
  const activeDevices = new Map<string, number>();
  const total = new Meter();
  const daily = new Map<number, Meter>();
  const clock = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const sessions: Session[] = [];
  let previous = events[0]?.[0] ?? 0;
  let sessionStart = 0, sessionEnd = -Infinity, current = new Meter();
  let sessionDevices = new Set<string>();
  const finish = () => {
    if (current.seconds >= 60) sessions.push({
      start: stamp(sessionStart, offset), end: stamp(sessionEnd, offset),
      device_ids: [...sessionDevices].sort(), ...current.values(),
    });
  };
  for (let i = 0; i < events.length;) {
    const mark = events[i][0];
    if (activeLevels.size) {
      let level = -Infinity;
      for (const active of activeLevels.keys()) level = Math.max(level, active);
      if (previous - sessionEnd > 180) {
        finish();
        sessionStart = previous;
        current = new Meter();
        sessionDevices = new Set();
      }
      current.add(mark - previous, level);
      for (const id of activeDevices.keys()) sessionDevices.add(id);
      sessionEnd = mark;
      total.add(mark - previous, level);
      for (let start = previous; start < mark;) {
        const hourId = Math.floor((start + offset) / HOUR);
        const end = Math.min(mark, (hourId + 1) * HOUR - offset);
        const day = dayOf(start, offset);
        const weekday = ((day + 3) % 7 + 7) % 7;
        const hour = (hourId % 24 + 24) % 24;
        const meter = daily.get(day) ?? new Meter();
        meter.add(end - start, level);
        daily.set(day, meter);
        clock[weekday][hour] += end - start;
        start = end;
      }
    }
    for (; i < events.length && events[i][0] === mark; i++) {
      const [, delta, level, id] = events[i];
      changeCount(activeLevels, level, delta);
      changeCount(activeDevices, id, delta);
    }
    previous = mark;
  }
  finish();
  return { total, daily, clock, sessions };
}

function maxBy<T>(values: Iterable<T>, metric: (value: T) => number): T | null {
  let best: T | null = null;
  for (const value of values) if (best === null || metric(value) > metric(best)) best = value;
  return best;
}

function overview({ total, daily, sessions }: ReturnType<typeof aggregate>, period: number) {
  const best = maxBy(daily, ([, meter]) => meter.seconds);
  return { ...total.values(), average_daily_seconds: period ? total.seconds / period : null,
    active_days: daily.size, active_day_ratio: period ? daily.size / period : null,
    average_active_day_seconds: daily.size ? total.seconds / daily.size : null, session_count: sessions.length,
    average_session_seconds: sessions.length ? sum(sessions.map(item => item.seconds)) / sessions.length : null,
    longest_session: maxBy(sessions, item => item.seconds),
    busiest_day: best ? { date: dayLabel(best[0]), ...best[1].values() } : null };
}

function timeline(first: number, last: number, daily: Map<number, Meter>) {
  const weeks = new Map<number, Meter>(), months = new Map<string, Meter>();
  const days = [];
  const empty = new Meter();
  for (let day = first; day <= last; day++) {
    const meter = daily.get(day) ?? empty;
    const date = dayLabel(day);
    const week = day - (day - first) % 7;
    const month = date.slice(0, 7);
    days.push({ date, ...meter.values() });
    const weekly = weeks.get(week) ?? new Meter();
    const monthly = months.get(month) ?? new Meter();
    weekly.merge(meter); monthly.merge(meter);
    weeks.set(week, weekly); months.set(month, monthly);
  }
  return { daily: days, weekly: [...weeks].map(([start, meter]) => ({
    start: dayLabel(start), end: dayLabel(Math.min(start + 6, last)), ...meter.values(),
  })), monthly: [...months].map(([month, meter]) => ({ month, ...meter.values() })) };
}

function longestStreak(daily: Map<number, Meter>) {
  let longest = 0, current = 0, previous = -Infinity;
  for (const day of daily.keys()) {
    current = day === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

function histogram(values: number[], cutoffs: number[]): Bin[] {
  return values.map((value, i) => ({ min_inclusive: cutoffs[i - 1] ?? null, max_exclusive: cutoffs[i] ?? null, value }));
}

function compare(rows: Reading[], last: number, offset: number, length: number): Comparison {
  const window = (end: number) => {
    const start = end - length + 1;
    const group = aggregate(rows, start, end, offset);
    return { start: dayLabel(start), end: dayLabel(end), ...group.total.values(), session_count: group.sessions.length };
  };
  const current = window(last), previous = window(last - length);
  return { current, previous, change: { seconds: current.seconds - previous.seconds,
    session_count: current.session_count - previous.session_count,
    average_dba: current.average_dba === null || previous.average_dba === null ? null : current.average_dba - previous.average_dba } };
}

export function buildReport(rows: Reading[], filters: Filters): { dashboard: Dashboard; sessions: Session[] } {
  const offsetMinutes = filters.offset ?? 480;
  const offset = offsetMinutes * 60;
  const catalog = new Map<string, Reading[]>();
  for (const row of rows) {
    const group = catalog.get(row[0]);
    if (group) group.push(row);
    else catalog.set(row[0], [row]);
  }
  const selected = filters.device ? catalog.get(filters.device) : rows;
  if (!selected) throw new ReportError(404, "找不到该耳机。");
  const span = bounds(selected, filters, offset);
  const [first, last] = span ?? [0, -1];
  const period = last - first + 1;
  const stats = aggregate(selected, first, last, offset);
  const history = timeline(first, last, stats.daily);
  const names = new Map<string, number>();
  for (const group of catalog.values()) changeCount(names, group.at(-1)![1], 1);
  const devices: Device[] = [];
  for (const [id, group] of catalog) {
    const [, name, manufacturer, model] = group.at(-1)!;
    const firstSeen = dayLabel(dayOf(group[0][4], offset));
    const lastSeen = dayLabel(dayOf(group.reduce((end, row) => Math.max(end, row[5]), group[0][5]) - 1, offset));
    const individual = aggregate(group, first, last, offset);
    devices.push({ id, name, manufacturer, model, first_seen: firstSeen, last_seen: lastSeen,
      label: (names.get(name) ?? 0) > 1 ? name + " · " + firstSeen.slice(0, 7) : name,
      ...overview(individual, period), share: null, monthly: timeline(first, last, individual.daily).monthly });
  }
  devices.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const totalDevice = sum(devices.map(device => device.seconds));
  if (totalDevice) for (const device of devices) device.share = device.seconds / totalDevice;
  const hourly = stats.clock[0].map((_, hour) => sum(stats.clock.map(day => day[hour])));
  const weekdays = stats.clock.map(sum);
  const durationBins = Array<number>(6).fill(0);
  for (const session of stats.sessions) durationBins[bandOf(session.seconds, sessionBands)]++;
  const dashboard: Dashboard = {
    range: span ? { start: dayLabel(first), end: dayLabel(last) } : null,
    offset_minutes: offsetMinutes,
    device_id: filters.device ?? null,
    summary: { ...overview(stats, period), longest_streak_days: longestStreak(stats.daily),
      peak_week: stats.daily.size ? maxBy(history.weekly, item => item.seconds) : null },
    devices, timeline: history,
    listening_clock: { hourly_seconds: hourly, weekday_seconds: weekdays, weekday_hour_seconds: stats.clock,
      peak_hour: stats.total.seconds ? hourly.indexOf(Math.max(...hourly)) : null,
      peak_weekday: stats.total.seconds ? weekdays.indexOf(Math.max(...weekdays)) + 1 : null,
      evening_ratio: stats.total.seconds ? sum(hourly.slice(18)) / stats.total.seconds : null },
    level_distribution: histogram(stats.total.bands, levelBands),
    session_duration_distribution: histogram(durationBins, sessionBands),
    comparisons: span ? { "7d": compare(selected, last, offset, 7), "30d": compare(selected, last, offset, 30) } : {},
  };
  return { dashboard, sessions: stats.sessions.reverse() };
}
