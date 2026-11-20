import { useId, useRef, useState, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import type { Dashboard, Measurement } from "../../api/types";
import { duration, hourAxis, hourRange, integer, level, monthDays, pad, ratio, weekdayOfFirst, weekdays } from "../../lib/format";
import { axes, Chart, cobalt, inkScreen, sunflower, valueAxis, vermilion, viridian, warningDecal } from "../charts/Chart";
import { Icon, Plate, Switch } from "./components";
import type { LedgerView } from "../sessions/SessionDrawer";

const metrics = [
  ["seconds", "时长"], ["average_dba", "平均声级"], ["at_least_80_dba_seconds", "≥80 dBA 时长"],
] as const;
export type Metric = typeof metrics[number][0];
const granularities = [["daily", "每日"], ["weekly", "每 7 天"], ["monthly", "每月"]] as const;
const soundViews = [["distribution", "声级分布"], ["weekly", "分周走势"]] as const;
const heatStep = (ratio: number) => ratio === 0 ? 0 : ratio < .16 ? 1 : ratio < .36 ? 2 : ratio < .62 ? 3 : ratio < .84 ? 4 : 5;

function formatMetric(value: number | null, metric: Metric) {
  return metric === "average_dba" ? level(value) : duration(value === null ? null : Math.round(value * 3600), true);
}

function Trend({ points, labels, metric, label }: {
  points: Measurement[]; labels: string[]; metric: Metric; label: string;
}) {
  const db = metric === "average_dba";
  const series = points.map(point => {
    const value = point[metric];
    return value === null || db ? value : value / 3600;
  });
  const stroke = db ? viridian : metric === "at_least_80_dba_seconds" ? vermilion : cobalt;
  const option: EChartsOption = {
    xAxis: { ...axes, type: "category", boundaryGap: false, data: labels, axisLabel: {
      ...axes.axisLabel, interval: Math.max(0, Math.ceil(labels.length / 4) - 1), formatter: value => value.split(" — ")[0].length === 10
        ? value.split(" — ")[0].slice(5) : value,
    } },
    yAxis: { ...valueAxis, min: db ? undefined : 0, splitNumber: 4, axisLabel: { ...axes.axisLabel, formatter: db ? "{value}" : hourAxis } },
    series: [{ name: label, type: "line", data: series, showSymbol: points.length <= 12, symbol: "emptyCircle", symbolSize: 5,
      sampling: db ? undefined : "lttb", connectNulls: false, lineStyle: { width: 2, color: stroke }, itemStyle: { color: stroke },
      areaStyle: { color: inkScreen(stroke) },
    }],
    tooltip: { valueFormatter: value => formatMetric(typeof value === "number" ? value : null, metric) },
  };
  return <Chart label={label} option={option} readings={labels.map((date, i) => ({ label: date, value: formatMetric(series[i], metric) }))} />;
}

export function Timeline({ data }: { data: Dashboard }) {
  const [grain, setGrain] = useState<"daily" | "weekly" | "monthly">();
  const [metric, setMetric] = useState<Metric>("seconds");
  const selected = grain ?? (data.timeline.daily.length <= 31 ? "daily" : "weekly");
  const points = data.timeline[selected];
  const labels = points.map(point => "date" in point ? point.date : "month" in point ? point.month : point.start + " — " + point.end);
  const roundedMinutes = Math.round(data.summary.seconds / 60);
  const peak = data.summary.peak_week;
  return <Plate index="01" title="累计聆听时长" icon="curve" className="overview">
    <div className="hero">
      <div>
        <div className="hero-total" aria-label={duration(data.summary.seconds)}>
          <strong>{integer.format(Math.floor(roundedMinutes / 60))}</strong><span>小时</span>
          <strong>{pad(roundedMinutes % 60)}</strong><span>分钟</span>
        </div>
        <p>日均 <b>{duration(data.summary.average_daily_seconds)}</b><span>按所选范围内每一天计算</span></p>
      </div>
      <div className="hero-print" aria-hidden="true"><i /></div>
    </div>
    <div className="chart-controls">
      <Switch values={granularities} value={selected} choose={setGrain} label="趋势粒度" />
      <Switch values={metrics} value={metric} choose={setMetric} label="趋势指标" />
    </div>
    <Trend points={points} labels={labels} metric={metric} label={metrics.find(([key]) => metric === key)![1] + "趋势"} />
    {peak && <div className="annotation"><span>最高 7 天分组</span><b>{duration(peak.seconds)}</b><small>{peak.start} 至 {peak.end}</small></div>}
  </Plate>;
}

export function Telemetry({ summary, open }: { summary: Dashboard["summary"]; open: (view: LedgerView) => void }) {
  const longest = summary.longest_session;
  const busiest = summary.busiest_day;
  const items = [
    { label: "使用次数", value: integer.format(summary.session_count) + " 次", detail: "不足 1 分钟的会话不计" },
    { label: "平均每次", value: duration(summary.average_session_seconds), detail: "计数会话的平均时长" },
    { label: "最长一次", value: duration(longest?.seconds ?? null), detail: longest?.start.slice(0, 10), action: longest ? () => open({ session: longest }) : undefined },
    { label: "听得最多的一天", value: duration(busiest?.seconds ?? null), detail: busiest?.date, action: busiest ? () => open({ day: busiest.date }) : undefined },
    { label: "使用天数", value: integer.format(summary.active_days) + " 天", detail: "占所选范围 " + ratio(summary.active_day_ratio) },
    { label: "使用日平均", value: duration(summary.average_active_day_seconds), detail: "仅算有记录的日子" },
  ];
  return <Plate index="03" title="使用统计" icon="bars" className="telemetry">
    <div className="metric-grid">{items.map(item => {
      const contents = <><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail ?? "—"}</small></>;
      return item.action ? <button key={item.label} className="metric-item" type="button" onClick={item.action}>{contents}<Icon name="arrow" /></button>
        : <div key={item.label} className="metric-item">{contents}</div>;
    })}</div>
  </Plate>;
}

const clockModes = [["compass", "时段罗盘"], ["matrix", "热力图"]] as const;

function Compass({ values, peak }: { values: number[]; peak: number | null }) {
  const maximum = Math.max(...values, 1);
  const [hour, setHour] = useState<number | null>(null);
  const selected = hour ?? peak;
  const pattern = useId();
  const point = (index: number, radius: number) => {
    const angle = index * Math.PI / 12;
    return [100 + radius * Math.sin(angle), 100 - radius * Math.cos(angle)];
  };
  const sector = (index: number, radius: number) => {
    const start = index - .38;
    const end = index + .38;
    return "M" + point(start, 36) + "L" + point(start, radius) + "A" + radius + " " + radius +
      " 0 0 1 " + point(end, radius) + "L" + point(end, 36) + "A36 36 0 0 0 " + point(start, 36) + "Z";
  };
  return <div className="compass-box">
    <svg viewBox="0 0 200 200" className="compass" role="group" aria-label="24 小时聆听分布">
      <defs>{[["ordinary", cobalt], ["peak", vermilion]].map(([name, color]) =>
        <pattern key={name} id={pattern + name} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill={color} />
        </pattern>)}</defs>
      <circle cx="100" cy="100" r="75" className="compass-ring" />
      <circle cx="100" cy="100" r="36" className="compass-ring compass-inner" />
      {values.map((seconds, index) => {
        const [x3, y3] = point(index, 76);
        const [x4, y4] = point(index, 80);
        const isPeak = index === peak;
        const radius = 39 + seconds / maximum * 32;
        return <g key={index} tabIndex={0} className={selected === index ? "compass-active" : ""} role="button"
          aria-label={hourRange(index) + "，" + duration(seconds, true)} onMouseEnter={() => setHour(index)}
          onMouseLeave={() => setHour(null)} onFocus={() => setHour(index)} onBlur={() => setHour(null)}
          onClick={() => setHour(index)} onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHour(index); }
          }}>
          <path d={sector(index, 80)} className="compass-hit" />
          <path d={sector(index, radius)} className={isPeak ? "compass-ink peak" : "compass-ink"} />
          <path d={sector(index, radius)} fill={"url(#" + pattern + (isPeak ? "peak" : "ordinary") + ")"} className="compass-screen" />
          <line x1={x3} y1={y3} x2={x4} y2={y4} className="compass-tick" />
        </g>;
      })}
      {[0, 6, 12, 18].map(index => {
        const [x, y] = point(index, 92);
        return <text key={index} className="compass-label" x={x} y={y} textAnchor="middle" dominantBaseline="central">{pad(index)}</text>;
      })}
      <path d="M93 100h14m-7-7v14" className="compass-tick" />
      {peak !== null && (() => {
        const [x, y] = point(peak, 84);
        return <path d={"M" + (x - 3) + " " + y + "h6m-3-3v6"} className="compass-peak" />;
      })()}
    </svg>
    <div className="compass-readout"><strong>{selected === null ? "—" : hourRange(selected)}</strong>
      <small>{hour === null ? "聆听高峰" : duration(values[hour], true)}</small></div>
  </div>;
}

export function ListeningClock({ data }: { data: Dashboard }) {
  const [mode, setMode] = useState<"compass" | "matrix">("compass");
  const [cell, setCell] = useState({ day: 0, hour: 0 });
  const matrix = useRef<HTMLTableElement>(null);
  const clock = data.listening_clock;
  const weekMax = Math.max(...clock.weekday_seconds, 1);
  const matrixMax = Math.max(...clock.weekday_hour_seconds.flat(), 1);
  const hourBars: EChartsOption = {
    grid: { top: 8, left: 36, right: 8, bottom: 25 },
    xAxis: { ...axes, type: "category", data: clock.hourly_seconds.map((_, i) => pad(i)), axisLabel: { ...axes.axisLabel, interval: 5 } },
    yAxis: { ...valueAxis, splitNumber: 3 },
    series: [{ type: "bar", data: clock.hourly_seconds.map((seconds, i) => ({ value: seconds / 3600,
      itemStyle: { color: i === clock.peak_hour ? vermilion : cobalt } })) }],
    tooltip: { valueFormatter: value => duration(Math.round(Number(value) * 3600), true) },
  };
  return <Plate index="04" title="聆听时段" icon="clock" className="clock-plate"
    action={<Switch values={clockModes} value={mode} choose={setMode} label="时段视图" />}>
    {mode === "compass" ? <><div className="clock-body">
      <Compass values={clock.hourly_seconds} peak={clock.peak_hour} />
      <div className="small-clock"><p className="chart-caption">聆听高峰 {clock.peak_hour === null ? "—" : hourRange(clock.peak_hour)}</p>
        <Chart option={hourBars} label="每小时聆听时长" height={132}
          readings={clock.hourly_seconds.map((value, i) => ({ label: hourRange(i), value: duration(value, true) }))} /></div>
      <dl className="clock-meta"><div><dt>最多的星期</dt><dd>{clock.peak_weekday === null ? "—" : weekdays[clock.peak_weekday - 1]}</dd></div>
        <div><dt>晚间占比</dt><dd>{ratio(clock.evening_ratio)}</dd><small>18:00–24:00</small></div></dl>
    </div>
    <div className="weekday-bars" aria-label="每周各日的累计时长">{clock.weekday_seconds.map((seconds, i) =>
      <div key={i} tabIndex={0} className={clock.peak_weekday === i + 1 ? "weekday-peak" : ""}
        aria-label={weekdays[i] + " " + duration(seconds, true)} title={duration(seconds, true)}>
        <span>{weekdays[i]}</span><i style={{ "--fill": seconds / weekMax } as CSSProperties} /><small>{duration(seconds)}</small>
      </div>)}</div></> :
      <><div className="matrix-scroll scroll-frame"><table className="matrix" ref={matrix}>
        <caption className="sr-only">一周七天各小时的累计聆听时长</caption><thead><tr><th scope="col">时</th>
          {clock.hourly_seconds.map((_, i) => <th scope="col" key={i}>{pad(i)}</th>)}</tr></thead>
        <tbody>{clock.weekday_hour_seconds.map((row, day) => <tr key={day}><th scope="row">{weekdays[day]}</th>
          {row.map((seconds, i) => <td key={i} data-heat={heatStep(seconds / matrixMax)}>
            <button type="button" data-cell={day + "-" + i} tabIndex={cell.day === day && cell.hour === i ? 0 : -1}
              aria-label={weekdays[day] + " " + hourRange(i) + " · " + duration(seconds, true)}
              onFocus={() => setCell({ day, hour: i })} onClick={() => setCell({ day, hour: i })}
              onKeyDown={event => {
                const dayStep = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                const hourStep = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                if (!dayStep && !hourStep) return;
                event.preventDefault();
                const nextDay = Math.max(0, Math.min(6, day + dayStep));
                const nextHour = Math.max(0, Math.min(23, i + hourStep));
                matrix.current?.querySelector<HTMLButtonElement>('[data-cell="' + nextDay + "-" + nextHour + '"]')?.focus();
              }} />
          </td>)}</tr>)}</tbody>
      </table></div><p className="matrix-readout" role="status">{weekdays[cell.day]} {hourRange(cell.hour)} · {duration(clock.weekday_hour_seconds[cell.day][cell.hour], true)}</p></>}
  </Plate>;
}

export function Calendar({ data, openDay }: { data: Dashboard; openDay: (day: string) => void }) {
  const [openMonth, setOpenMonth] = useState("");
  const months = new Map(data.timeline.monthly.map(point => [point.month, point]));
  const years = [...new Set(data.timeline.monthly.map(point => point.month.slice(0, 4)))];
  const monthMax = data.timeline.monthly.reduce((maximum, point) => Math.max(maximum, point.seconds), 1);
  const selected = months.get(openMonth);
  const monthPoints = data.timeline.daily.filter(point => point.date.startsWith(openMonth));
  const dayMax = monthPoints.reduce((maximum, point) => Math.max(maximum, point.seconds), 1);
  const days = new Map(monthPoints.map(point => [point.date, point.seconds]));
  const [year, month] = openMonth.split("-").map(Number);
  return <Plate index="02" title="聆听日历" icon="calendar" className="calendar-plate"
    action={<small className="plate-aside">最长连续 {data.summary.longest_streak_days} 天</small>}>
    <div className="calendar-summary"><span>{data.summary.active_days} 天有记录</span><span className="calendar-key">少 <i /><i /><i /><i /> 多</span></div>
    <div className="year-scroll scroll-frame"><table className="year-grid" aria-label="分月聆听日历">
      <thead><tr><th scope="col">年</th>{Array.from({ length: 12 }, (_, i) => <th key={i} scope="col">{pad(i + 1)}</th>)}</tr></thead>
      <tbody>{years.map(value => <tr key={value}><th scope="row">{value}</th>{Array.from({ length: 12 }, (_, i) => {
        const key = value + "-" + pad(i + 1);
        const month = months.get(key);
        return <td key={key}><button className="exposure-cell" type="button" disabled={!month} aria-pressed={openMonth === key}
          aria-label={key + "，" + (month ? duration(month.seconds, true) : "筛选区间外")}
          title={month ? key + " · " + duration(month.seconds, true) : "筛选区间外"}
          data-heat={heatStep((month?.seconds ?? 0) / monthMax)}
          onClick={() => setOpenMonth(openMonth === key ? "" : key)} /></td>;
      })}</tr>)}</tbody>
    </table></div>
    {selected && <div className="month-detail">
      <div><strong>{year} 年 {month} 月</strong><span>{duration(selected.seconds)}</span></div>
      <div className="month-grid">{weekdays.map(day => <span key={day}>{day}</span>)}
        {Array.from({ length: weekdayOfFirst(year, month) }, (_, i) => <i key={"spacer-" + i} />)}
        {Array.from({ length: monthDays(year, month) }, (_, i) => {
          const date = openMonth + "-" + pad(i + 1);
          const seconds = days.get(date);
          const exposure = (seconds ?? 0) / dayMax;
          return <button key={date} className={"exposure-cell day " + (seconds === 0 ? "no-data-day" : "")}
            type="button" disabled={seconds === undefined} aria-disabled={seconds === 0 || undefined}
            title={seconds === undefined ? "筛选区间外" : seconds === 0 ? "无记录" : duration(seconds, true)}
            aria-label={date + "，" + (seconds === undefined ? "筛选区间外" : seconds === 0 ? "无记录" : duration(seconds, true))}
            data-heat={heatStep(exposure)}
            onClick={() => { if (seconds) openDay(date); }}>{i + 1}</button>;
        })}
      </div>
    </div>}
  </Plate>;
}

const bands = ["<70", "70–<80", "80–<85", "85–<90", "≥90"];
export function SoundExposure({ data }: { data: Dashboard }) {
  const [display, setDisplay] = useState<"distribution" | "weekly">("distribution");
  const [metric, setMetric] = useState<"average_dba" | "at_least_80_dba_seconds">("average_dba");
  const summary = data.summary;
  const position = summary.average_dba === null ? null : Math.min(100, Math.max(0, (summary.average_dba - 40) / 60 * 100));
  const option: EChartsOption = {
    grid: { top: 10, left: 48, right: 8, bottom: 24 },
    xAxis: { ...axes, type: "category", data: bands },
    yAxis: { ...valueAxis, splitNumber: 3, axisLabel: { ...axes.axisLabel, formatter: hourAxis } },
    series: [{ type: "bar", barMaxWidth: 27, data: data.level_distribution.map((band, i) => ({
      value: band.value / 3600, itemStyle: { color: [viridian, sunflower, vermilion, vermilion, vermilion][i],
        ...(i >= 2 ? { decal: { ...warningDecal, dashArrayY: [2, 7 - i] } } : {}) },
    })) }],
    tooltip: { valueFormatter: value => duration(Math.round(Number(value) * 3600), true) },
  };
  return <Plate index="05" title="耳机声级" icon="mark" className="sound-plate"
    action={<Switch values={soundViews} value={display} choose={setDisplay} label="声级图表" />}>
    <div className="sound-main"><div><small>等效平均声级</small><strong>{summary.average_dba?.toFixed(2) ?? "—"} <span>dBA</span></strong></div>
      <div className="above-threshold"><small>≥80 dBA</small><b>{duration(summary.at_least_80_dba_seconds)}</b>
        <span>{ratio(summary.at_least_80_dba_ratio)}</span></div></div>
    <div className="scale" aria-label="40 至 100 dBA 声级标尺">
      <div className="scale-arm"><span className="scale-threshold" />
        {position !== null && <span className="scale-point" style={{ left: position + "%" }} title={level(summary.average_dba)} />}</div>
      <div className="scale-labels"><span>40</span><span>80 dBA</span><span>100</span></div>
    </div>
    {display === "distribution" ? <Chart option={option} label="声级分布" height={112}
      readings={data.level_distribution.map((band, i) => ({ label: bands[i] + " dBA", value: duration(band.value, true) }))} /> :
      <><Switch values={[["average_dba", "平均声级"], ["at_least_80_dba_seconds", "≥80 dBA 时长"]]}
        value={metric} choose={setMetric} label="分周声级指标" />
        <Trend points={data.timeline.weekly} labels={data.timeline.weekly.map(point => point.start + " — " + point.end)}
          metric={metric} label="每 7 天声级走势" /></>}
  </Plate>;
}
