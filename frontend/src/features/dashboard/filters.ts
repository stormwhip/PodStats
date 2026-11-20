import type { Filters, Preset } from "../../api/types";
import { validDay } from "../../lib/format";

export const presets: [Preset, string][] = [
  ["all", "全部"], ["1y", "近 1 年"], ["90d", "90 天"], ["30d", "30 天"], ["7d", "7 天"],
];

export function getFilters(search: string): Filters {
  const query = new URLSearchParams(search);
  const device = query.get("device") || undefined;
  const range = presets.find(([value]) => value === query.get("range"))?.[0];
  const rawOffset = query.get("offset");
  const offset = rawOffset && /^-?\d+$/.test(rawOffset) && Math.abs(Number(rawOffset)) <= 1439 ? Number(rawOffset) : undefined;
  const start = query.get("start") ?? "";
  const end = query.get("end") ?? "";
  if (validDay(start) && validDay(end) && start <= end) return { device, offset, start, end };
  const asOf = query.get("as_of") ?? "";
  return { device, offset, range, as_of: range && range !== "all" && validDay(asOf) ? asOf : undefined };
}
