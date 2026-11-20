import { SaxesParser } from "saxes";

export type Reading = [id: string, name: string, maker: string | null, model: string | null,
  start: number, end: number, level: number];

interface ZipMember {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

async function zipXml(file: File) {
  const tailOffset = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--;
  const invalid = () => new Error("无法读取 ZIP。请先解压，再选择导出的 XML。");
  if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) throw invalid();
  const directorySize = tail.getUint32(end + 12, true);
  const directoryStart = tail.getUint32(end + 16, true);
  if (directoryStart + directorySize > tailOffset + end || directorySize > 64 * 1024 * 1024) throw invalid();
  const directory = new DataView(await file.slice(directoryStart, directoryStart + directorySize).arrayBuffer());
  const candidates: ZipMember[] = [];
  const decoder = new TextDecoder();
  for (let cursor = 0; cursor < directory.byteLength;) {
    if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== 0x02014b50) throw invalid();
    const length = directory.getUint16(cursor + 28, true);
    const next = cursor + 46 + length + directory.getUint16(cursor + 30, true) + directory.getUint16(cursor + 32, true);
    if (next > directory.byteLength) throw invalid();
    const name = decoder.decode(new Uint8Array(directory.buffer, cursor + 46, length));
    if (/\.xml$/i.test(name) && !/(^|\/)export_cda\.xml$/i.test(name) && !name.split("/").includes("__MACOSX")) {
      candidates.push({ name, flags: directory.getUint16(cursor + 8, true), method: directory.getUint16(cursor + 10, true),
        compressed: directory.getUint32(cursor + 20, true), size: directory.getUint32(cursor + 24, true),
        offset: directory.getUint32(cursor + 42, true) });
    }
    cursor = next;
  }
  const preferred = candidates.filter(item => /(^|\/)apple_health_export\/[^/]+$/i.test(item.name));
  const eligible = preferred.length ? preferred : candidates;
  const standard = eligible.filter(item => /(^|\/)export\.xml$/i.test(item.name));
  const choices = standard.length ? standard : eligible;
  if (choices.length !== 1) throw new Error("未找到唯一的健康数据 XML。请解压后选择导出的 XML。");
  const member = choices[0];
  if (member.flags & 1 || member.offset + 30 > directoryStart || member.compressed === 0xffffffff ||
    member.size === 0xffffffff) throw invalid();
  const header = new DataView(await file.slice(member.offset, member.offset + 30).arrayBuffer());
  if (header.getUint32(0, true) !== 0x04034b50) throw invalid();
  const start = member.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + member.compressed > directoryStart) throw invalid();
  const raw = file.slice(start, start + member.compressed).stream();
  if (member.method === 0) return { stream: raw, size: member.size };
  if (member.method === 8) {
    try {
      return { stream: raw.pipeThrough(new DecompressionStream("deflate-raw")), size: member.size };
    } catch {
      throw invalid();
    }
  }
  throw invalid();
}

const exposure = "HKQuantityTypeIdentifierHeadphoneAudioExposure";
const fields = /(?:^|,\s*)(name|manufacturer|model|localIdentifier|UDI):\s*(.*?)(?=,\s*(?:name|manufacturer|model|localIdentifier|UDI|creation date|hardware|firmware|software):|$)/g;

function timestamp(input: string | undefined) {
  if (!input || !/(?:[+-]\d{2}:?\d{2}|Z)$/.test(input)) return NaN;
  return Math.trunc(Date.parse(input.replace(" ", "T").replace(/ (?=[+-]\d)/, "")) / 1000);
}

export async function importHealth(file: File, progress: (ratio: number) => void): Promise<Reading[]> {
  const source = /\.zip$/i.test(file.name) ? await zipXml(file) :
    /\.xml$/i.test(file.name) ? { stream: file.stream(), size: file.size } : null;
  if (!source) throw new Error("请选择 Apple 健康导出的 ZIP 或 XML 文件。");
  const parser = new SaxesParser();
  const rows: Reading[] = [];
  const identities = new Map<string, string>();
  const rawDevices = new Map<string, [string, string, string | null, string | null]>();
  const unique = new Set<string>();
  let root = false;
  let consumed = 0;
  let update = 0;
  parser.on("doctype", declaration => {
    if (/<!ENTITY\b/i.test(declaration)) throw new Error("此 XML 包含自定义实体。请使用健康 App 原始导出文件。");
  });
  parser.on("error", () => { throw new Error("XML 格式无效或文件未完整导出。"); });
  parser.on("opentag", tag => {
    if (!root) {
      if (tag.name !== "HealthData") throw new Error("请选择 Apple 健康导出的主 XML 文件。");
      root = true;
    }
    const a = tag.attributes;
    if (tag.name !== "Record" || a.type !== exposure || a.unit !== "dBASPL") return;
    const start = timestamp(a.startDate);
    const end = timestamp(a.endDate);
    const level = a.value?.trim() ? Number(a.value) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      !Number.isFinite(level) || level < -100 || level > 200) return;
    const raw = a.device ?? "";
    const cacheKey = raw + "\0" + (a.sourceName ?? "");
    let device = rawDevices.get(cacheKey);
    if (!device) {
      const info = Object.fromEntries(Array.from(raw.replace(/^<+|>+$/g, "").matchAll(fields), match => [match[1], match[2]]));
      const name = info.name || "未知耳机";
      const maker = info.manufacturer ?? null;
      const model = info.model ?? null;
      const identifier = info.localIdentifier || info.UDI;
      const key = identifier ? "hardware:" + identifier.replace(/(-tacl|-tsco)$/i, "").toLowerCase() :
        JSON.stringify([name, maker, model, name === "未知耳机" ? a.sourceName ?? null : null]);
      let id = identities.get(key);
      if (!id) { id = String(identities.size); identities.set(key, id); }
      device = [id, name, maker, model];
      rawDevices.set(cacheKey, device);
    }
    const key = [device[0], start, end, level].join("|");
    if (unique.has(key)) return;
    unique.add(key);
    rows.push([...device, start, end, level]);
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = source.stream.getReader();
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consumed += value.byteLength;
      if (consumed > source.size) throw new Error("文件内容与 ZIP 记录的大小不符。");
      parser.write(decoder.decode(value, { stream: true }));
      const percent = Math.min(.99, consumed / Math.max(1, source.size));
      if (percent >= update + .01) { progress(percent); update = percent; }
    }
    if (consumed !== source.size) throw new Error("未能完整读取导出文件。");
    parser.write(decoder.decode()).close();
    complete = true;
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const hashed = new Map(await Promise.all([...identities].map(async ([identity, id]) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    return [id, Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("")] as const;
  })));
  for (const row of rows) row[0] = hashed.get(row[0])!;
  return rows.sort((a, b) => a[4] - b[4] || a[5] - b[5] || a[0].localeCompare(b[0]) || a[6] - b[6]);
}
