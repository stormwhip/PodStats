import type { Dashboard, Device, Filters, Range, SessionPage } from "./types";
import { BrowserDataError, readBrowser } from "./browser-client";

export const pagesMode = import.meta.env.MODE === "pages";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return query.size ? "?" + query.toString() : "";
}

async function get<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  if (pagesMode) {
    if (path === "health") return { service: "PodStats", status: "ok", api_version: 1 } as T;
    const { limit, skip, ...filters } = params;
    try {
      return await readBrowser<T>(path as "dashboard" | "devices" | "sessions",
        filters as Filters, signal, limit as number | undefined, skip as number | undefined);
    } catch (error) {
      if (error instanceof BrowserDataError) throw new ApiError(error.status, error.message);
      throw error;
    }
  }
  const response = await fetch("/api/v1/" + path + queryString(params), {
    signal, headers: { Accept: "application/json" }, cache: "no-store",
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(0, "无法连接本地 PodStats 服务");
  }
  const payload = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload.error ?? "请求失败");
  return payload as T;
}

export const api = {
  health: (signal?: AbortSignal) => get<{ service: string; status: "ok"; api_version: number }>("health", {}, signal),
  dashboard: (filters: Filters, signal?: AbortSignal) => get<Dashboard>("dashboard", { ...filters }, signal),
  devices: (filters: Filters, signal?: AbortSignal) => get<{ range: Range | null; items: Device[] }>("devices", { ...filters }, signal),
  sessions: (filters: Filters, limit: number, skip: number, signal?: AbortSignal) =>
    get<SessionPage>("sessions", { ...filters, limit, skip }, signal),
};
