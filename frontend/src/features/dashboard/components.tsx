import type { CSSProperties, ReactNode } from "react";
import type { Dashboard, Device, Filters } from "../../api/types";
import { deviceColor, duration, utcLabel, validDay } from "../../lib/format";
import empty from "../../assets/cyanotype/empty.webp";
import earbud from "../../assets/cyanotype/earbud.webp";
import overear from "../../assets/cyanotype/overear.webp";
import wireless from "../../assets/cyanotype/wireless.webp";
import { presets } from "./filters";
import { useState } from "react";

const paths = {
  mark: "M3 12h4l2.5-6 4 12 2.5-6H21 M12 2v2m0 16v2",
  headphones: "M4 15v-3a8 8 0 1 1 16 0v3M4 14h3v6H5l-1-1zm16 0h-3v6h2l1-1z",
  refresh: "M18.5 8A7 7 0 1 0 19 15m-.5-7V4m0 4h-4",
  arrow: "M5 19 19 5M8 5h11v11",
  calendar: "M5 5h14v15H5zM8 3v4m8-4v4M5 9h14m-10 5h2m2 0h2m-6 3h2",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3v5l3 2",
  curve: "M4 19V5m0 14h16M6 15l4-5 4 3 5-7",
  bars: "M4 19h16M7 17v-6m5 6V6m5 11V9",
  list: "M8 6h12M8 12h12M8 18h12M4 6h1m-1 6h1m-1 6h1",
  close: "M6 6l12 12M18 6 6 18",
  right: "M9 6l6 6-6 6",
};
export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2"><path d={paths[name]} /></svg>;
}

export function specimen(device?: Device) {
  if (!device || /airpods max|over-ear|头戴/i.test(device.name)) return overear;
  return /airpods|freebuds|bowie/i.test(device.name) ? earbud : wireless;
}

export function Plate({ index, title, icon, children, className = "", action }: {
  index: string; title: string; icon: IconName; children: ReactNode; className?: string; action?: ReactNode;
}) {
  return <section className={"plate " + className} aria-labelledby={"plate-" + index}>
    <header className="plate-head">
      <div className="plate-label"><span className="fig" aria-hidden="true">FIG. {index}</span>
        <Icon name={icon} /><h2 id={"plate-" + index}>{title}</h2></div>
      {action}
    </header>
    {children}
  </section>;
}

export function Switch<T extends string>({ values, value, choose, label }: {
  values: readonly (readonly [T, string])[]; value: T | undefined; choose: (value: T) => void; label: string;
}) {
  return <div className="switch" role="group" aria-label={label}>{values.map(([key, name]) =>
    <button key={key} type="button" aria-pressed={key === value} onClick={() => choose(key)}>{name}</button>
  )}</div>;
}

export function DeviceStrip({ devices, total, last, selected, historical, onSelect }: {
  devices: Device[]; total?: number; last?: string; selected?: string; historical: boolean; onSelect: (id?: string) => void;
}) {
  const entries = [{ id: undefined, label: "全部耳机", seconds: total, last_seen: last, device: undefined },
    ...devices.map(device => ({ ...device, device }))];
  return <nav className="devices" aria-label="耳机目录">
    <div className="device-scroll">{entries.map(entry => <button key={entry.id ?? "all"} type="button"
      className="device" title={entry.label} aria-pressed={selected === entry.id}
      style={entry.id ? { "--device-color": deviceColor(entry.id) } as CSSProperties : undefined} onClick={event => {
        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
        onSelect(entry.id);
      }}>
      {selected === entry.id ? <img src={specimen(entry.device)} alt="" /> : <Icon name="headphones" />}
      <span className="device-copy"><strong>{entry.label}</strong>
        <small>{!historical || entry.seconds === undefined ? "—" : duration(entry.seconds)}
          {entry.last_seen && " · " + entry.last_seen.slice(5)}</small></span>
    </button>)}</div>
  </nav>;
}

export function Controls({ filters, history, dash, choose, refresh, busy, apiError }: {
  filters: Filters; history: Dashboard | null; dash: Dashboard | null; choose: (filters: Filters) => void;
  refresh: () => void; busy: boolean; apiError?: string;
}) {
  const selected = history?.devices.find(device => device.id === filters.device) ?? dash?.devices.find(device => device.id === filters.device);
  const historyStart = selected?.first_seen ?? history?.range?.start;
  const historyEnd = selected?.last_seen ?? history?.range?.end;
  const startValue = filters.start ?? dash?.range?.start ?? "";
  const endValue = filters.end ?? dash?.range?.end ?? "";
  return <section className="controls" aria-label="统计筛选">
    <div className="view-label">
      <h2>{selected?.label ?? "全部耳机"}</h2>
      <small>{historyStart && historyEnd ? "历史范围 " + historyStart + " — " + historyEnd : "历史范围 —"}</small>
    </div>
    <div className="control-main">
      <Switch values={presets} value={filters.start ? undefined : filters.range ?? "all"}
        choose={range => choose({ device: filters.device, offset: filters.offset, range })} label="日期预设" />
      <DateForm key={startValue + "/" + endValue} startValue={startValue} endValue={endValue}
        error={apiError} apply={(start, end) => choose({ device: filters.device, offset: filters.offset, start, end })} />
      <div className="control-actions">
        <OffsetSelect offset={filters.offset ?? dash?.offset_minutes ?? 480} choose={offset => choose({ ...filters, offset })} />
        <button className="icon-button" type="button" aria-label="刷新数据" title="刷新数据" onClick={refresh} disabled={busy}><Icon name="refresh" /></button>
      </div>
    </div>
  </section>;
}

function DateForm({ startValue, endValue, apply, error }: {
  startValue: string; endValue: string; apply: (start: string, end: string) => void; error?: string;
}) {
  const [start, setStart] = useState(startValue);
  const [end, setEnd] = useState(endValue);
  const [invalid, setInvalid] = useState("");
  const [edited, setEdited] = useState(false);
  const message = invalid || (!edited ? error : "");
  return <form className="date-form" noValidate onSubmit={event => {
    event.preventDefault();
    if (!validDay(start) || !validDay(end)) { setInvalid("请选择完整的起止日期。"); return; }
    if (start > end) { setInvalid("起始日期须早于或等于结束日期。"); return; }
    setEdited(false);
    apply(start, end);
  }}>
    <input aria-label="筛选起始日" aria-invalid={Boolean(message)} type="date" value={start}
      onChange={event => { setStart(event.target.value); setInvalid(""); setEdited(true); }} />
    <span className="date-dash" aria-hidden="true">—</span>
    <input aria-label="筛选结束日" aria-invalid={Boolean(message)} type="date" value={end}
      onChange={event => { setEnd(event.target.value); setInvalid(""); setEdited(true); }} />
    <button type="submit">应用</button>
    {message && <small className="input-error" role="alert">{message}</small>}
  </form>;
}

const offsets = Array.from({ length: 105 }, (_, i) => -720 + i * 15);
function OffsetSelect({ offset, choose }: { offset: number; choose: (value: number) => void }) {
  const options = offsets.includes(offset) ? offsets : [...offsets, offset].sort((a, b) => a - b);
  return <select aria-label="统计 UTC 偏移" value={offset} onChange={event => choose(Number(event.target.value))}>
    {options.map(value => <option value={value} key={value}>{utcLabel(value)}</option>)}
  </select>;
}

export function EmptyLibrary({ refresh }: { refresh: () => void }) {
  return <section className="empty-library" aria-labelledby="empty-heading">
    <img src={empty} alt="" />
    <div><h2 id="empty-heading">还没有耳机记录</h2>
      <p>在 Apple 健康应用的个人资料中导出健康数据，在项目目录导入 ZIP 或 XML。</p>
      <pre>python -m podstats import "导出.zip"{"\n"}python -m podstats serve</pre>
      <button type="button" onClick={refresh}><Icon name="refresh" /> 导入后刷新</button>
    </div>
  </section>;
}

export function LoadingPlate() {
  return <div className="skeleton" role="status" aria-label="正在读取聆听记录"><div /><div /><div /><div /></div>;
}
