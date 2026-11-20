import { useState } from "react";
import { importBrowserFile } from "../../api/browser-client";
import empty from "../../assets/cyanotype/empty.webp";

export function BrowserImport({ compact, loaded }: { compact: boolean; loaded: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function read(file: File) {
    setError("");
    setProgress(0);
    try {
      await importBrowserFile(file, setProgress);
      loaded();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "导入失败，请重试。");
    } finally {
      setProgress(null);
    }
  }

  const input = <label className="browser-file">
    <span>{progress !== null ? "正在读取…" : compact ? "换个文件" : "选择 ZIP 或 XML 文件"}</span>
    <input type="file" accept=".zip,.xml,application/zip,application/xml,text/xml" disabled={progress !== null}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void read(file);
      }} />
  </label>;
  const status = progress !== null ?
    <div className="browser-progress" role="status">解析中 {Math.floor(progress * 100)}% <progress value={progress} max={1} /></div> :
    error ? <p className="browser-error" role="alert">{error}</p> : null;

  if (compact) return <div className="browser-import-compact">{input}{status}</div>;
  return <section className="empty-library browser-import" aria-labelledby="import-title">
    <div>
      <h2 id="import-title">导入 Apple 健康数据</h2>
      <p>选择导出文件，查看你的耳机使用统计。文件在当前浏览器页面内处理。</p>
      <ol>
        <li>在 iPhone 打开「健康」App，进入「摘要」，轻点右上角的个人资料头像。</li>
        <li>滑到底部，轻点「导出所有健康数据」，将 ZIP 保存到「文件」。</li>
        <li>在这里选择 ZIP。也可以先解压，再选择主 XML 文件。</li>
      </ol>
      {input}
      {status}
      <p className="browser-local-note">刷新或关闭页面后，需要重新选择文件。</p>
    </div>
    <img src={empty} alt="" />
  </section>;
}
