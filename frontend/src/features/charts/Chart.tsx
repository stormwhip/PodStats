import { useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import { init, use, type EChartsType } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, AriaComponent, GraphicComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, AriaComponent, GraphicComponent, SVGRenderer]);

export const ink = "#8FB3BE";
export const cyan = "#5CE1E6";
export const vermilion = "#E06D44";
export const mono = '"IBM Plex Mono", ui-monospace, Consolas, monospace';

const tip: EChartsOption["tooltip"] = {
  trigger: "axis", triggerOn: "mousemove|click", confine: true, renderMode: "richText",
  backgroundColor: "#0F2A34", borderColor: "#5B8995", borderWidth: 1, borderRadius: 0,
  padding: [10, 12], textStyle: { color: "#E8F4F6", fontFamily: mono, fontSize: 12 },
  axisPointer: { type: "line", lineStyle: { color: ink, type: "dashed" } },
  extraCssText: "box-shadow:none",
};

export const axes = {
  axisLabel: { color: ink, fontFamily: mono, fontSize: 10, hideOverlap: true },
  axisLine: { show: false },
  axisTick: { show: false },
};
export const valueAxis = {
  ...axes, type: "value" as const, min: 0,
  splitLine: { show: true, lineStyle: { color: "rgba(164,214,224,.22)", type: "dashed" as const } },
};

export interface Reading { label: string; value: string }

export function Chart({ option, label, readings = [], height = 200, onPoint }: {
  option: EChartsOption; label: string; readings?: Reading[]; height?: number; onPoint?: (index: number) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const handler = useRef(onPoint);
  const position = useRef(-1);
  const [readout, setReadout] = useState("");
  handler.current = onPoint;
  useEffect(() => {
    if (!node.current) return;
    const instance = init(node.current, undefined, { renderer: "svg" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node.current);
    instance.on("click", event => { if (event.componentType === "series") handler.current?.(event.dataIndex); });
    return () => { observer.disconnect(); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.current?.setOption({
      animation: !reduceMotion, animationDuration: 240, animationDurationUpdate: 240,
      animationEasing: "cubicOut", textStyle: { fontFamily: mono, color: ink },
      grid: { top: 14, left: 48, right: 10, bottom: 29, containLabel: false },
      ...option, tooltip: { ...tip, ...option.tooltip },
    }, true);
    position.current = -1;
    setReadout("");
  }, [option]);
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!readings.length) return;
    if (event.key === "Enter" && position.current >= 0 && onPoint) {
      event.preventDefault();
      onPoint(position.current);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const index = position.current < 0 ? (step > 0 ? 0 : readings.length - 1)
      : (position.current + step + readings.length) % readings.length;
    position.current = index;
    const reading = readings[index];
    setReadout(reading.label + " · " + reading.value);
    chart.current?.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: index });
  };
  return <div className="chart-shell">
    <div ref={node} className="chart" aria-label={label + "，用左右方向键查看数据"} role="group"
      tabIndex={readings.length ? 0 : undefined} style={{ height }} onKeyDown={keyboard}
      onBlur={() => { chart.current?.dispatchAction({ type: "hideTip" }); setReadout(""); }} />
    <span className="chart-keyboard" role="status">{readout}</span>
  </div>;
}
