import { useEffect, useState } from "react";
import { api, ApiError, pagesMode, queryString } from "../../api/client";
import type { Dashboard, Device, Filters } from "../../api/types";
import { rangeLabel } from "../../lib/format";
import { Controls, DeviceStrip, EmptyLibrary, LoadingPlate } from "./components";
import { getFilters } from "./filters";
import { Calendar, ListeningClock, SoundExposure, Telemetry, Timeline } from "./CorePlates";
import { DeviceAtlas, SessionsAndChanges } from "./DeepPlates";
import { SessionDrawer, type LedgerView } from "../sessions/SessionDrawer";
import { BrowserImport } from "./BrowserImport";
import wordmark from "../../assets/cyanotype/wordmark.webp";

// Fragments stay in the browser when a Pages URL is reloaded.
const currentQuery = () => pagesMode ? window.location.hash.slice(1) : window.location.search;
const locationFor = (query: string) => window.location.pathname + (pagesMode && query ? "#" : "") + query;

function getError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400) return "后端无法处理此筛选。请检查日期区间是否有效。";
    if (error.status === 500) return "暂时无法读取本地数据。";
  }
  return "无法连接本地服务。";
}

export function App() {
  const [filters, setFilters] = useState(() => getFilters(currentQuery()));
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<Dashboard | null>(null);
  const [baseline, setBaseline] = useState<{ data: Dashboard; offset?: number; refreshKey: number } | null>(null);
  const [catalogFallback, setCatalogFallback] = useState<Device[]>([]);
  const [pending, setPending] = useState(true);
  const [issue, setIssue] = useState<{ message: string; status: number }>();
  const [notice, setNotice] = useState("");
  const [ledger, setLedger] = useState<LedgerView>();
  const [imported, setImported] = useState(!pagesMode);
  const offset = filters.offset;
  const fullRange = !filters.device && !filters.start && (!filters.range || filters.range === "all");
  const history = baseline && baseline.offset === offset ? baseline.data : null;

  function apply(next: Filters, replace = false) {
    const search = queryString({ ...next });
    if (search === currentQuery()) return;
    if (replace) window.history.replaceState(null, "", locationFor(search));
    else window.history.pushState(null, "", locationFor(search));
    setPending(true);
    setIssue(undefined);
    setFilters(next);
  }

  function refresh() {
    setPending(true);
    setIssue(undefined);
    setRefreshKey(value => value + 1);
  }

  useEffect(() => {
    const sync = () => {
      setPending(true);
      setIssue(undefined);
      setFilters(getFilters(currentQuery()));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!imported) return;
    const controller = new AbortController();
    const { signal } = controller;
    api.dashboard(filters, signal).then(result => {
      if (signal.aborted) return;
      setData(result);
      if (fullRange) setBaseline({ offset, data: result, refreshKey });
      setPending(false);
    }).catch(error => {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.status === 404 && filters.device) {
        setNotice("找不到该耳机，已切回全部耳机。");
        const next = { ...filters, device: undefined };
        window.history.replaceState(null, "", locationFor(queryString(next)));
        setFilters(next);
        return;
      }
      setIssue({ message: getError(error), status: error instanceof ApiError ? error.status : 0 });
      setPending(false);
      if (!data) api.health(signal).then(() => api.devices({ offset }, signal)).then(result => {
        if (!signal.aborted) setCatalogFallback(result.items);
      }).catch(() => {});
    });
    return () => controller.abort();
    // Data belongs to the previous completed request until this one resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, fullRange, offset, refreshKey, imported]);

  useEffect(() => {
    if (!imported || fullRange || (baseline && baseline.offset === offset && baseline.refreshKey === refreshKey)) return;
    const controller = new AbortController();
    api.dashboard({ offset }, controller.signal).then(result => {
      if (!controller.signal.aborted) setBaseline({ offset, data: result, refreshKey });
    }).catch(() => {});
    return () => controller.abort();
  }, [fullRange, offset, refreshKey, baseline, imported]);

  const devices = history?.devices ?? data?.devices ?? catalogFallback;
  function selectDevice(device?: string) {
    setNotice("");
    apply({ ...filters, device });
  }
  function open(view: LedgerView) { setLedger(view); }
  function onImported() {
    const next = { offset };
    window.history.replaceState(null, "", locationFor(queryString(next)));
    setImported(true);
    setFilters(next);
    setBaseline(null);
    setNotice("");
    setLedger(undefined);
    refresh();
  }

  return <main className="sheet">
    <header className="masthead">
      <div className="wordmark"><h1><img src={wordmark} alt="PodStats" /></h1><span className="wordmark-sub">聆听图鉴 <span>· VOL.01</span></span></div>
      {pagesMode && imported ? <BrowserImport compact loaded={onImported} /> :
        <div className="header-meta">APPLE HEALTH <span aria-hidden="true">/</span> 本地档案</div>}
    </header>
    {pagesMode && !imported ? <BrowserImport compact={false} loaded={onImported} /> : <>
    <DeviceStrip devices={devices} total={history?.summary.seconds} last={history?.range?.end} historical={history !== null}
      selected={filters.device} onSelect={selectDevice} />
    <Controls filters={filters} history={history} dash={data} choose={apply} refresh={refresh} busy={pending}
      apiError={issue?.status === 400 ? issue.message : undefined} />
    {notice && <p className="notice" role="status">{notice}</p>}
    {pending && data && <p className="progress-message" role="status">正在更新统计</p>}
    {issue && issue.status !== 400 && <section className="notice error" role="alert">
      <strong>{issue.message}</strong>{issue.status === 0 && <code>python -m podstats serve</code>}
      <button type="button" onClick={refresh}>重试</button>
    </section>}
    {!data && pending && <LoadingPlate />}
    {data && !data.devices.length && <EmptyLibrary refresh={refresh} />}
    {data && data.devices.length > 0 && <div className={pending || issue ? "dashboard updating" : "dashboard"} aria-busy={pending}>
      {!pending && !issue && data.summary.seconds === 0 && <div className="notice empty-filter">
        {rangeLabel(data.range)} 没有聆听记录。
        <button type="button" onClick={() => apply({ device: filters.device, offset, range: "all" })}>查看全部</button>
      </div>}
      <div className="main-grid">
        <Timeline data={data} />
        <Telemetry summary={data.summary} open={open} />
        <ListeningClock data={data} />
        <Calendar data={data} openDay={day => open({ day })} />
        <SoundExposure data={data} />
      </div>
      <DeviceAtlas devices={data.devices} select={selectDevice} />
      <SessionsAndChanges data={data} openAll={() => open({})} />
      <footer className="sheet-footer"><span className="footer-brand"><img src={wordmark} alt="PodStats" /><span>／ Apple 健康</span></span><span>{rangeLabel(data.range)}</span></footer>
    </div>}
    {ledger && <SessionDrawer view={ledger} filters={filters} devices={devices} close={() => setLedger(undefined)} />}
    </>}
  </main>;
}
