import { importHealth, type Reading } from "./health-import";
import { buildReport, ReportError } from "./health-report";
import type { Filters } from "./types";

export type Request = { id: number } & ({ action: "import"; file: File } |
  { action: "dashboard" | "devices" | "sessions"; filters: Filters; limit?: number; skip?: number });
export type Reply = { id: number } & ({ progress: number } | { result: unknown } | { error: string; status: number });

let rows: Reading[] = [];
let cache: { key: string; report: ReturnType<typeof buildReport> } | undefined;
const send = (message: Reply) => self.postMessage(message);

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  const id = request.id;
  try {
    if (request.action === "import") {
      const incoming = await importHealth(request.file, progress => send({ id, progress }));
      if (!incoming.length) throw new Error("这个文件没有可用于统计的耳机音频记录。");
      rows = incoming;
      cache = undefined;
      send({ id, result: rows.length });
      return;
    }
    const key = JSON.stringify(request.filters);
    if (cache?.key !== key) cache = { key, report: buildReport(rows, request.filters) };
    const { dashboard, sessions } = cache.report;
    const { range, offset_minutes } = dashboard;
    if (request.action === "dashboard") send({ id, result: dashboard });
    else if (request.action === "devices") send({ id, result: { range, items: dashboard.devices } });
    else {
      const limit = request.limit ?? 25;
      const skip = request.skip ?? 0;
      send({ id, result: { range, offset_minutes, items: sessions.slice(skip, skip + limit), total: sessions.length, limit, skip } });
    }
  } catch (error) {
    send({ id, status: error instanceof ReportError ? error.status : 400,
      error: error instanceof Error ? error.message : "读取数据失败。" });
  }
});
