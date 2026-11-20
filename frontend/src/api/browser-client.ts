import type { Reply, Request } from "./health-worker";
import type { Filters } from "./types";

let worker: Worker | undefined;
let serial = 0;

export class BrowserDataError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function request<T>(message: Omit<Extract<Request, { action: "import" }>, "id"> |
  Omit<Exclude<Request, { action: "import" }>, "id">, signal?: AbortSignal, progress?: (ratio: number) => void) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const port = worker ??= new Worker(new URL("./health-worker.ts", import.meta.url), { type: "module" });
    const id = ++serial;
    function cleanup() {
      port.removeEventListener("message", onMessage);
      port.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
    }
    function onMessage(event: MessageEvent<Reply>) {
      const response = event.data;
      if (response.id !== id) return;
      if ("progress" in response) { progress?.(response.progress); return; }
      cleanup();
      if ("error" in response) reject(new BrowserDataError(response.status, response.error));
      else resolve(response.result as T);
    }
    function fail() {
      cleanup();
      if (worker === port) { port.terminate(); worker = undefined; }
      reject(new BrowserDataError(400, "无法启动浏览器解析。请刷新网页后重试。"));
    }
    function abort() { cleanup(); reject(signal!.reason); }
    port.addEventListener("message", onMessage);
    port.addEventListener("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    port.postMessage({ ...message, id });
  });
}

export function importBrowserFile(file: File, progress: (ratio: number) => void) {
  return request<number>({ action: "import", file }, undefined, progress);
}

export function readBrowser<T>(action: "dashboard" | "devices" | "sessions", filters: Filters,
  signal?: AbortSignal, limit?: number, skip?: number) {
  return request<T>({ action, filters, limit, skip }, signal);
}
