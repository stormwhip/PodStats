export const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
export const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
export const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const pad = (value: number) => String(value).padStart(2, "0");

export function duration(seconds: number | null, exact = false) {
  if (seconds === null) return "—";
  if (!exact && seconds > 0 && seconds < 60) return "<1 分钟";
  const minutes = exact ? Math.floor(seconds / 60) : Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const parts = [hours ? integer.format(hours) + " 小时" : "", minutes % 60 ? minutes % 60 + " 分钟" : ""];
  if (exact && (seconds % 60 || !minutes)) parts.push(Math.round(seconds % 60) + " 秒");
  return parts.filter(Boolean).join(" ") || "0 分钟";
}

export const level = (value: number | null) => value === null ? "—" : value.toFixed(2) + " dBA";
export const ratio = (value: number | null) => value === null ? "—" : decimal.format(value * 100) + "%";
export const hours = (value: number) => decimal.format(value / 3600);
export const hourRange = (hour: number) => pad(hour) + ":00–" + pad(hour + 1) + ":00";
export const localStamp = (stamp: string) => stamp.slice(0, 10) + " " + stamp.slice(11, 19);
export const hourAxis = (value: number) => decimal.format(value) + " h";
export const rangeLabel = (range: { start: string; end: string } | null) =>
  range ? range.start + " 至 " + range.end : "暂无日期";
export function utcLabel(offset: number) {
  const magnitude = Math.abs(offset);
  return "UTC" + (offset < 0 ? "−" : "+") + pad(Math.floor(magnitude / 60)) + ":" + pad(magnitude % 60);
}

export function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 2 && year <= 9998 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays(year, month);
}

export function monthDays(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function weekdayOfFirst(year: number, month: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return (date.getUTCDay() + 6) % 7;
}

const palette = ["#5CE1E6", "#D8A25E", "#85C79A", "#E06D44", "#A5B4FC", "#E295B3", "#94D2BD", "#CBD5E1"];
export function deviceColor(id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Extend collided palette slots with a stable lightness variation.
  const index = hash >>> 0;
  const color = palette[index % palette.length];
  const variation = Math.floor(index / palette.length) % 5;
  const amount = [0, 0.15, -0.14, 0.27, -0.23][variation];
  const channels = color.slice(1).match(/../g)?.map(channel => parseInt(channel, 16)) ?? [];
  return "rgb(" + channels.map(channel => Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount)).join(",") + ")";
}
