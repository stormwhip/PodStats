import { useState, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import type { Dashboard, Device } from "../../api/types";
import { decimal, deviceColor, duration, hourAxis, integer, level, ratio } from "../../lib/format";
import { axes, Chart, cyan, valueAxis, vermilion } from "../charts/Chart";
import { Icon, Plate, Switch } from "./components";

const ranks = [["seconds", "时长"], ["active_days", "天数"], ["average_session_seconds", "每次"], ["average_dba", "声级"]] as const;
type Rank = typeof ranks[number][0];
const stackModes = [["absolute", "时长"], ["ratio", "占比"]] as const;

function rankValue(device: Device, rank: Rank) {
  return rank === "average_dba" ? level(device[rank]) : rank === "active_days"
    ? integer.format(device[rank]) + " 天" : duration(device[rank], true);
}

export function DeviceAtlas({ devices, select }: { devices: Device[]; select: (id: string) => void }) {
  const [rank, setRank] = useState<Rank>("seconds");
  const [stack, setStack] = useState<"absolute" | "ratio">("absolute");
  const [hidden, setHidden] = useState<string[]>([]);
  const active = devices.filter(device => device.seconds > 0);
  const ranked = [...devices].sort((a, b) => (b[rank] ?? -Infinity) - (a[rank] ?? -Infinity) || a.label.localeCompare(b.label));
  const stacked = devices.filter(device => !hidden.includes(device.id));
  const months = devices[0]?.monthly.map(point => point.month) ?? [];
  const monthlyByDevice = new Map(stacked.map(device => [device.id, new Map(device.monthly.map(point => [point.month, point.seconds]))]));
  const totals = months.map(month => stacked.reduce((sum, device) => sum + (monthlyByDevice.get(device.id)?.get(month) ?? 0), 0));
  const portion: EChartsOption = {
    tooltip: { trigger: "item", valueFormatter: value => duration(Number(value), true) },
    series: [{ type: "pie", radius: ["60%", "83%"], center: ["50%", "50%"], minAngle: 0,
      label: { show: false }, labelLine: { show: false }, itemStyle: { borderColor: "#0B2028", borderWidth: 1 },
      data: active.map(device => ({ name: device.label, value: device.seconds, itemStyle: { color: deviceColor(device.id) } })),
    }],
  };
  const rankIsTime = rank === "seconds" || rank === "average_session_seconds";
  const ranking: EChartsOption = {
    grid: { top: 6, left: 5, right: 15, bottom: 24, containLabel: true },
    xAxis: { ...valueAxis, splitNumber: 3, axisLabel: { ...axes.axisLabel, formatter: rankIsTime ? hourAxis : "{value}" } },
    yAxis: { ...axes, type: "category", inverse: true, data: ranked.map(device => device.label),
      axisLabel: { ...axes.axisLabel, width: 115, overflow: "truncate", interval: 0 } },
    series: [{ type: "bar", barMaxWidth: 10, data: ranked.map(device => ({
      value: device[rank] === null ? null : rankIsTime ? device[rank] / 3600 : device[rank],
      itemStyle: { color: deviceColor(device.id) },
    })) }],
    tooltip: { trigger: "item", valueFormatter: value => {
      if (typeof value !== "number") return "—";
      if (rank === "average_dba") return level(value);
      return rankIsTime ? duration(Math.round(value * 3600), true) : integer.format(value) + " 天";
    } },
  };
  const stacking: EChartsOption = {
    xAxis: { ...axes, type: "category", data: months, axisLabel: { ...axes.axisLabel, interval: Math.ceil(months.length / 6) - 1 } },
    yAxis: { ...valueAxis, max: stack === "ratio" ? 1 : undefined, splitNumber: 4,
      axisLabel: { ...axes.axisLabel, formatter: stack === "ratio" ? ratio : hourAxis } },
    series: stacked.map(device => ({ type: "bar", name: device.label, stack: "month", barMaxWidth: 16,
      itemStyle: { color: deviceColor(device.id) }, data: months.map((month, index) => {
        const seconds = monthlyByDevice.get(device.id)?.get(month) ?? 0;
        return stack === "absolute" ? seconds / 3600 : totals[index] ? seconds / totals[index] : 0;
      }) })),
    tooltip: { valueFormatter: value => stack === "ratio" ? ratio(Number(value)) : duration(Math.round(Number(value) * 3600), true) },
  };
  return <Plate index="06" title="设备对比" icon="bars" className="deep-plate">
    <div className="atlas-grid">
      <section className="sub-plate"><h3>时长占比</h3>
        {active.length ? <div className="donut">
          <Chart label="设备时长占比" height={162} option={portion}
            onPoint={index => { if (active[index]) select(active[index].id); }}
            readings={active.map(device => ({ label: device.label, value: ratio(device.share) + " · " + duration(device.seconds, true) }))} />
          <div className="donut-center"><strong>{active.length}</strong><small>副有记录</small></div>
        </div> : <p className="chart-empty">所选日期内无设备活动</p>}
        <div className="device-legend">{devices.map(device => <button type="button" key={device.id}
          title={device.label + " · " + duration(device.seconds, true)} onClick={() => select(device.id)}>
          <i style={{ "--device-color": deviceColor(device.id) } as CSSProperties} /><span>{device.label}</span><small>{ratio(device.share)}</small>
        </button>)}</div>
      </section>
      <section className="sub-plate"><div className="sub-head"><h3>设备排名</h3>
        <Switch values={ranks} value={rank} choose={setRank} label="设备排名指标" /></div>
        <Chart label="设备排名" height={Math.max(190, ranked.length * 28 + 26)} option={ranking}
          onPoint={index => { if (ranked[index]) select(ranked[index].id); }}
          readings={ranked.map(device => ({ label: device.label, value: rankValue(device, rank) }))} />
      </section>
      <section className="sub-plate"><div className="sub-head"><h3>月度设备构成</h3>
        <Switch values={stackModes} value={stack} choose={setStack} label="月度构成指标" /></div>
        <div className="scroll-frame"><div style={{ minWidth: Math.min(950, months.length * 22) }}>
          <Chart label="各设备月度构成" height={195} option={stacking} readings={months.map((month, i) => ({
            label: month, value: stacked.map(device => {
              const seconds = monthlyByDevice.get(device.id)?.get(month) ?? 0;
              return device.label + " " + (stack === "ratio" ? ratio(totals[i] ? seconds / totals[i] : null) : duration(seconds, true));
            }).join("，") || "未选设备",
          }))} />
        </div></div>
        <div className="stack-legend" aria-label="月度图设备图例">{devices.map(device => <button type="button" key={device.id}
          aria-pressed={!hidden.includes(device.id)} onClick={() => setHidden(items => items.includes(device.id)
            ? items.filter(id => id !== device.id) : [...items, device.id])}>
          <i style={{ "--device-color": deviceColor(device.id) } as CSSProperties} />{device.label}
        </button>)}</div>
      </section>
    </div>
  </Plate>;
}

const windows = [["7d", "7 天"], ["30d", "30 天"]] as const;
const changeMetrics = [["seconds", "时长"], ["session_count", "次数"], ["average_dba", "声级"]] as const;
type ChangeMetric = typeof changeMetrics[number][0];
const sessionBands = ["<5", "5–<15", "15–<30", "30–<60", "60–<120", "≥120"];

function signed(value: number | null, metric: ChangeMetric) {
  if (value === null) return "—";
  const amount = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return sign + (metric === "seconds" ? duration(amount, true) : metric === "average_dba" ? level(amount) : integer.format(amount) + " 次");
}

export function SessionsAndChanges({ data, openAll }: { data: Dashboard; openAll: () => void }) {
  const [window, setWindow] = useState<"7d" | "30d">("7d");
  const [metric, setMetric] = useState<ChangeMetric>("seconds");
  const comparison = data.comparisons[window];
  const histogram: EChartsOption = {
    xAxis: { ...axes, type: "category", data: sessionBands },
    yAxis: { ...valueAxis, splitNumber: 4, minInterval: 1 },
    series: [{ type: "bar", barMaxWidth: 31, itemStyle: { color: cyan },
      data: data.session_duration_distribution.map(bin => bin.value) }],
    tooltip: { valueFormatter: value => integer.format(Number(value)) + " 次" },
  };
  const compare: EChartsOption = {
    xAxis: { ...axes, type: "category", data: ["对比区间"] },
    yAxis: { ...valueAxis, splitNumber: 4, min: metric === "average_dba" ? undefined : 0,
      axisLabel: { ...axes.axisLabel, formatter: metric === "seconds" ? hourAxis : "{value}" } },
    series: ["current", "previous"].map((key, i) => {
      const source = comparison?.[key as "current" | "previous"];
      const value = source?.[metric] ?? null;
      return {
        name: (i ? "上期 " : "本期 ") + (source ? source.start + " 至 " + source.end : ""),
        type: "bar", barMaxWidth: 30, itemStyle: { color: i ? "#507985" : cyan },
        data: [value !== null && metric === "seconds" ? value / 3600 : value],
      };
    }),
    tooltip: { valueFormatter: value => typeof value === "number"
      ? metric === "seconds" ? duration(Math.round(value * 3600), true)
        : metric === "average_dba" ? level(value) : integer.format(value) + " 次" : "—" },
  };
  return <Plate index="07" title="会话分布与近期变化" icon="list" className="deep-plate"
    action={<button className="action-button" type="button" onClick={openAll}>会话档案 <Icon name="arrow" /></button>}>
    <div className="sessions-grid">
      <section className="sub-plate"><div className="sub-head"><h3>单次聆听时长</h3><span className="muted">横轴 / 分钟</span></div>
        <Chart label="单次聆听时长分布" height={175} option={histogram} readings={data.session_duration_distribution.map((bin, i) =>
          ({ label: sessionBands[i] + " 分钟", value: integer.format(bin.value) + " 次" }))} />
        <p className="chart-caption">仅纳入记录覆盖至少 60 秒的会话。</p>
      </section>
      <section className="sub-plate"><div className="sub-head"><h3>近期对比</h3>
        <Switch values={windows} value={window} choose={setWindow} label="近期对比周期" /></div>
        <Switch values={changeMetrics} value={metric} choose={setMetric} label="近期对比指标" />
        {comparison ? <>
          <Chart label="本期和上期对比" height={130} option={compare} readings={[{
            label: "本期和上期", value: signed(comparison.change[metric], metric) + "（本期减上期）",
          }]} />
          <div className="pair-dates"><span><i />本期 {comparison.current.start} 至 {comparison.current.end}</span>
            <span><i />上期 {comparison.previous.start} 至 {comparison.previous.end}</span></div>
          <dl className="delta-list">{changeMetrics.map(([key, title]) =>
            <div key={key}><dt>{title}</dt><dd style={key === "average_dba" && (comparison.change[key] ?? 0) > 0 ? { color: vermilion } : undefined}>
              {signed(comparison.change[key], key)}</dd></div>)}</dl>
        </> : <p className="chart-empty">暂无可比较的日期范围</p>}
      </section>
    </div>
  </Plate>;
}
