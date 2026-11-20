export interface Range { start: string; end: string }
export type Preset = "all" | "1y" | "90d" | "30d" | "7d";
export interface Filters {
  device?: string;
  range?: Preset;
  start?: string;
  end?: string;
  offset?: number;
  as_of?: string;
}
export interface Measurement {
  seconds: number;
  average_dba: number | null;
  at_least_80_dba_seconds: number;
  at_least_80_dba_ratio: number | null;
}
export type DailyPoint = Measurement & { date: string };
export type WeeklyPoint = Measurement & Range;
export type MonthlyPoint = Measurement & { month: string };
export interface Session extends Measurement, Range { device_ids: string[] }
export interface Overview extends Measurement {
  average_daily_seconds: number | null;
  active_days: number;
  active_day_ratio: number | null;
  average_active_day_seconds: number | null;
  session_count: number;
  average_session_seconds: number | null;
  longest_session: Session | null;
  busiest_day: DailyPoint | null;
}
export interface Device extends Overview {
  id: string;
  name: string;
  label: string;
  manufacturer: string | null;
  model: string | null;
  first_seen: string;
  last_seen: string;
  share: number | null;
  monthly: MonthlyPoint[];
}
export interface Bin { min_inclusive: number | null; max_exclusive: number | null; value: number }
export type ComparisonWindow = WeeklyPoint & { session_count: number };
export interface Comparison {
  current: ComparisonWindow;
  previous: ComparisonWindow;
  change: Pick<Overview, "seconds" | "session_count" | "average_dba">;
}
export interface Dashboard {
  range: Range | null;
  offset_minutes: number;
  device_id: string | null;
  summary: Overview & { longest_streak_days: number; peak_week: WeeklyPoint | null };
  devices: Device[];
  timeline: { daily: DailyPoint[]; weekly: WeeklyPoint[]; monthly: MonthlyPoint[] };
  listening_clock: {
    hourly_seconds: number[];
    weekday_seconds: number[];
    weekday_hour_seconds: number[][];
    peak_hour: number | null;
    peak_weekday: number | null;
    evening_ratio: number | null;
  };
  level_distribution: Bin[];
  session_duration_distribution: Bin[];
  comparisons: Partial<Record<"7d" | "30d", Comparison>>;
}
export interface SessionPage {
  range: Range | null;
  offset_minutes: number;
  items: Session[];
  total: number;
  limit: number;
  skip: number;
}
