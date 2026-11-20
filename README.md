# PodStats

PodStats 从 Apple 健康导出中提取耳机音频暴露记录，提供本地统计 API。运行需要 Python 3.11 或更新版本，使用 Python 标准库和 SQLite。

## 网页版

打开 [PodStats](https://stormwhip.github.io/PodStats/)，按页面提示从 iPhone「健康」App 导出所有健康数据，再选择 ZIP 或主 XML 文件。浏览器在后台解析文件和计算统计。每次刷新页面后可重新选择文件。

GitHub Pages 发布 `main` 分支的 `/docs` 目录。更新网页版时，在 `frontend/` 运行 `npm run build:pages`，然后提交源码和更新后的 `docs/`。仓库中只应提交源码、网页文件与合成测试样本。

## 打开仪表盘

发布包含已构建的网页。解压后，在 PodStats 根目录运行以下命令。已导入数据时可直接运行第二行。

```powershell
python -m podstats import "导出.zip"
python -m podstats serve --frontend frontend/dist
```

在浏览器打开 [PodStats](http://127.0.0.1:8765/)。在 macOS 或以 `python3` 启动 Python 的环境中，将命令里的 `python` 换成 `python3`。新导入数据后，可用仪表盘的「刷新数据」按钮重查本地数据库。

界面提供设备与日期筛选、日／周／月趋势、时段罗盘、年／月聆听日历、80 dBA 声级分布、设备占比与排名、分月构成、近期对比和分页会话档案。

## 前端开发

前端源代码位于 `frontend/`。开发需要 Node.js 20.19+ 或 22.12+。先在项目根目录启动 `python -m podstats serve`，再在另一个终端执行。

```powershell
cd frontend
npm install
npm run dev
```

Vite 将同源 `/api` 转发到 `127.0.0.1:8765`，并调整请求 Host。从终端显示的地址打开前端。修改页面后，运行 `npm run build` 进行类型检查并更新 `frontend/dist`，可用上面的 Python 命令查看构建版。生产版的前端资源和接口共用本机端口。

### 蓝晒版面

| 区域 | 桌面 | 窄屏 |
|---|---|---|
| 页首 | 标题、横向设备目录、历史边界与时间筛选控制栏 | 标题与可横滚设备目录；日期、预设和 UTC 控件按宽度换行 |
| 主图版 | 左列 58% 为时长、趋势、日历，右列 42% 为六项指标、时段、声级 | 小于 900 px 时为单列；窄手机使用两列指标卡、24 小时柱图、可横滚年月表与热力矩阵 |
| 下方分析 | 设备占比、排名、月度构成三栏；会话分布与近期变化双栏 | 手机逐项堆叠 |
| 会话档案 | 右侧 500 px 抽屉 | 近全屏，支持 Esc 关闭和焦点归还 |

视觉变量位于 `frontend/src/styles/main.css`。页面采用暖白棉纸 `#F4F2EC`、象牙白图版 `#FCFBF8` 和碳黑墨色 `#141C22`，边界使用 1 px 细线。普鲁士蓝集中用于声学罗盘、声波标本和图表提示。趋势、声级分布和设备图表使用矿物色谱，朱砂色标记 ≥80 dBA 声级区间。品牌艺术字与图版素材位于 `frontend/src/assets/cyanotype/`。合成测试数据位于 `frontend/src/fixtures/listening.json`。

## 导入与运行

在项目根目录执行以下命令。把示例文件名换成你的 ZIP 或 XML 路径。

```powershell
python -m podstats import "导出.zip"
python -m podstats serve
```

数据库默认写入 `data/podstats.sqlite3`。可在子命令前用 `--db` 指定其他位置。导入逐块读取文件，仅写入耳机数据。重复导入同一设备、起止时刻和声级的记录时会去重。XML 解析失败时，本次写入整体回滚。

启动后可在本机访问 [统计接口](http://127.0.0.1:8765/api/v1/dashboard)。服务监听 `127.0.0.1`，默认端口为 8765，可用 `serve --port` 修改。

## API

| GET 路径 | 返回内容 |
|---|---|
| `/api/v1/health` | 服务版本和运行状态 |
| `/api/v1/dashboard` | 总览、设备对比、趋势、时段、日历、声级和会话分布、近期对比 |
| `/api/v1/devices` | 设备列表、各副耳机的统计和月度趋势 |
| `/api/v1/sessions` | 最新在前的会话明细，支持 `limit`（默认 50，最多 200）和 `skip`（默认 0） |

三个统计路径共同支持以下参数。

| 参数 | 用法 |
|---|---|
| `device` | 设备列表返回的 `id`。省略时总览按全部耳机计算。设备对比仍保留全部设备，日期随总览的所选区间更新。 |
| `range` | `all`（默认）、`1y`、`90d`、`30d` 或 `7d`。`all` 对应所选设备的记录跨度。 |
| `as_of` | 近期区间的截止日期，格式为 `YYYY-MM-DD`。省略时取统计时区的当天。 |
| `start`、`end` | 自定义起止日期，格式为 `YYYY-MM-DD`，包含首尾两天。成对提交。 |
| `offset` | 固定 UTC 偏移分钟数，默认 480（UTC+08:00）。跨时区的记录统一换算到这个偏移后分桶。 |

## 图表数据

| 图表 | Dashboard 字段 |
|---|---|
| 折线图 | `timeline.daily`、`weekly`、`monthly` 提供时长、平均声级和 ≥80 dBA 时长。每周分桶从筛选首日开始，每桶 7 天。最后一桶可短于 7 天。 |
| 饼图或环形图 | `devices[].share` 表示各设备净时长占各设备净时长总和的比例。 |
| 排名柱状图 | `devices[]` 按筛选时长降序，含使用天数、平均每次时长和平均声级。 |
| 堆叠柱状图 | `devices[].monthly` 提供每副耳机的分月统计。 |
| 小时与星期柱状图 | `listening_clock.hourly_seconds`、`weekday_seconds` 分别按 0–23 点和周一到周日排列。 |
| 热力图和日历 | `listening_clock.weekday_hour_seconds` 为 7×24 矩阵。`timeline.daily` 和 `timeline.monthly` 提供日历数据。 |
| 声级、会话直方图 | `level_distribution` 以秒为单位，`session_duration_distribution` 以会话数为单位。分档为左闭右开，`null` 表示开放端点。 |
| 近期对比柱状图 | `comparisons` 比较以筛选结束日为锚点的最近 7／30 天和相邻的上一段等长区间。 |

时长字段以秒为单位，占比用 0–1 的小数，无可用观测的平均值为 `null`。

## 统计规则

- 重叠时间只计算一次。重叠声级取较高的记录值，再按区间时长做能量加权。80 dBA 统计基于导出区间的记录声级，反映这些区间的累计覆盖时长。
- 同一硬件标识的两种音频模式归为同一设备。缺少硬件标识时按设备属性回退匹配。设备列表中的 ID 为归并后标识的哈希值。
- 相距不超过 180 秒的记录归为同一会话，会话时长只计算记录覆盖的秒数。覆盖不足 60 秒的会话仅计入时长、日历和声级等统计。按日期筛选时，先裁剪记录，再计算会话。
- 按本地自然日计算日均、使用天数、最长连续使用天数和高峰时段。晚间区间为 18:00–24:00。
