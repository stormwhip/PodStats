import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Device, Filters, Session, SessionPage } from "../../api/types";
import { deviceColor, duration, level, localStamp, rangeLabel, utcLabel } from "../../lib/format";
import { Icon } from "../dashboard/components";

export interface LedgerView { day?: string; session?: Session }

function SessionEntry({ session, names }: { session: Session; names: Map<string, string> }) {
  return <article className="session-entry">
    <header><strong>{duration(session.seconds, true)}</strong><span>{level(session.average_dba)}</span></header>
    <div className="session-times"><time dateTime={session.start}>{localStamp(session.start)}</time>
      <span aria-hidden="true">—</span><time dateTime={session.end}>{localStamp(session.end)}</time></div>
    <ul>{session.device_ids.map(id => <li key={id} style={{ "--device-color": deviceColor(id) } as CSSProperties}>
      <Icon name="headphones" />{names.get(id) ?? "未知耳机"}
    </li>)}</ul>
    {session.at_least_80_dba_seconds > 0 && <small className="session-above">≥80 dBA · {duration(session.at_least_80_dba_seconds, true)}</small>}
  </article>;
}

export function SessionDrawer({ view, filters, devices, close }: {
  view: LedgerView; filters: Filters; devices: Device[]; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [day, setDay] = useState(view.day);
  const [showList, setShowList] = useState(!view.session);
  const [skip, setSkip] = useState(0);
  const [page, setPage] = useState<SessionPage>();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const limit = 25;
  useEffect(() => {
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const panel = dialog.current;
    panel?.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      panel?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (!showList) return;
    const controller = new AbortController();
    const query = day ? { device: filters.device, offset: filters.offset, start: day, end: day } : filters;
    setState("loading");
    api.sessions(query, limit, skip, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPage(result);
      setState("loaded");
    }, () => {
      if (!controller.signal.aborted) setState("error");
    });
    return () => controller.abort();
  }, [day, filters, retry, showList, skip]);

  const names = new Map(devices.map(device => [device.id, device.label]));
  const sessionOffset = view.session?.start.slice(19).replace("-", "−");
  const title = view.session ? "最长一次聆听" : day ? "当日会话" : "会话档案";
  return <dialog className="ledger" ref={dialog} aria-labelledby="ledger-title" onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <div className="ledger-inner">
      <header className="ledger-header"><div><small>{day ?? (sessionOffset ? "UTC" + sessionOffset : page ? utcLabel(page.offset_minutes) : "聆听时长")}</small>
        <h2 id="ledger-title">{title}</h2></div>
        <button type="button" className="icon-button" aria-label="关闭会话档案" ref={closeButton} onClick={close}><Icon name="close" /></button></header>
      {view.session && <>
        <SessionEntry session={view.session} names={names} />
        {!showList && <button className="action-button" type="button" onClick={() => {
          setDay(view.session!.start.slice(0, 10)); setShowList(true);
        }}>查看开始当天的会话 <Icon name="right" /></button>}
      </>}
      {showList && <section className="ledger-list" aria-busy={state === "loading"}>
        {day && <p className="chart-caption">仅显示当天的记录。跨午夜会话按当日范围裁剪。</p>}
        {state === "loading" && <p className="notice" role="status">正在读取会话…</p>}
        {state === "error" && <p className="notice" role="alert">暂时无法读取会话。 <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
        {state === "loaded" && page && <>
          <p className="ledger-range">{rangeLabel(page.range)} · {utcLabel(page.offset_minutes)} · {page.total.toLocaleString("zh-CN")} 次</p>
          {!page.items.length && <p>该范围没有记录覆盖满 1 分钟的会话。</p>}
          {page.items.map(session => <SessionEntry key={session.start + session.end} session={session} names={names} />)}
          {page.total > limit && <div className="pagination">
            <button type="button" disabled={skip === 0} onClick={() => { setSkip(Math.max(0, skip - limit)); setState("loading"); }}>上一页</button>
            <span>{Math.floor(skip / limit) + 1} / {Math.ceil(page.total / limit)}</span>
            <button type="button" disabled={skip + page.items.length >= page.total} onClick={() => { setSkip(skip + limit); setState("loading"); }}>下一页</button>
          </div>}
        </>}
      </section>}
    </div>
  </dialog>;
}
