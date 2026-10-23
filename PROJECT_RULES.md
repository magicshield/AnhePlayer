# PROJECT_RULES.md

> 记录本项目**长期有效、可复用**的经验、踩坑、约束与关键决策。
> 只记录值得长期记住的内容；一次性需求与临时方案不入册。

---

## 一、性能与内存

### 1.1 WebView 内存分析必须按进程分解实测，禁止凭直觉优化

**触发信号**：有人反馈「空载内存占用高」「内存能不能优化」。

**根因/约束**：WebView/Chromium 是多进程架构。不同进程的内存成因和优化手段完全不同，凭直觉猜测几乎必然指向错误方向。

**正确做法**：先分解，再决策。

```powershell
$perf = @{}
Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $perf[[int]$_.IDProcess] = $_.WorkingSetPrivate }
Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*anhe*' } | ForEach-Object {
  $cl = [string]$_.CommandLine; $t = 'browser'
  if ($cl -match '--type=([a-zA-Z-]+)') { $t = $Matches[1] }
  if ($cl -match '--utility-sub-type=([a-zA-Z0-9._]+)') { $t = $t + ':' + ($Matches[1] -replace '\.mojom\..*','') }
  New-Object PSObject -Property @{ Role = $t; MB = [math]::Round($perf[[int]$_.ProcessId]/1MB,1) }
} | Sort-Object MB -Descending | Format-Table -AutoSize
```

**验证方式**：各进程 `WorkingSetPrivate` 之和应约等于任务管理器显示的数字（实测 240.8MB vs 244.5MB，吻合）。
注意 `WorkingSet64` 含共享内存，会虚高 2~3 倍（实测总和 737MB），**不要用它下结论**。

**适用范围**：WebView 内存问题。

---

### 1.2 GPU 进程内存高不等于代码有问题 —— 先做同机横向对比

**触发信号**：GPU 进程占了总内存的一半，第一反应是「GPU 有问题」。

**根因/约束**：GPU 进程内存里有很大一块是显卡驱动（ANGLE/D3D11）的固定开销，**与应用代码无关**。在集显机器上尤其明显：没有独立显存，纹理全部从系统内存分配，本该进 VRAM 的开销会直接计入进程内存。

**正确做法**：在**同一台机器**上对比其他 Chromium 应用的 GPU 进程，再判断是否异常。

实测基线（AMD Radeon 核显，1920×1080）：

| 应用           | GPU 进程专用内存 |
| -------------- | ---------------- |
| Chrome         | 251 MB           |
| VS Code        | 225 MB           |
| QQ             | 115 MB           |
| **AnhePlayer** | **103~128 MB**   |
| Edge WebView2  | 79 MB            |

结论：本项目 GPU 进程处于正常偏低水平，**不要把精力投在「压缩 GPU 进程」这个方向**。但这不代表 GPU 里没有可优化项 —— 见 1.3。

**适用范围**：Chromium/WebView 应用的 GPU 内存判断。

---

### 1.3 常驻的 backdrop-filter 是 GPU 内存最大的单点浪费

**触发信号**：全局常驻 UI（侧边栏、播放栏、顶栏）上写了 `backdrop-filter: blur(...)`。

**根因/约束**：`backdrop-filter` 会强制创建 GPU 合成层，并为背景采样保存额外纹理。元素越大、越常驻，代价越高。**当背景色不透明度 ≥ 0.9 时，模糊在视觉上几乎不可见，但 GPU 开销是全额的。**

**正确做法**：

- 不透明度 ≥ 0.9 的背景上不要叠 `backdrop-filter`，直接删除，视觉无损。
- 全宽/全屏的常驻元素优先排查。
- `global.scss` 里已有 `:root.no-blur` 降级开关（把所有 blur token 归零并移除合成层），但**从未被任何代码启用过** —— 若要做「性能模式」设置项，直接复用它即可。

**验证方式**：实测删除 `PlayerBar` 中 `background-color: rgba(25,25,25,0.9)` 上叠加的 `blur(40px)`（一条横跨窗口的常驻伪元素层），GPU 进程 **102.7 MB → 70.3 MB，省约 32 MB**。这是本项目单点收益最大的一处改动，成本只有删 1 行 CSS。

**适用范围**：所有全局常驻 UI 样式。

---

### 1.4 触碰 navigator.mediaDevices 会拉起常驻的 VideoCaptureService 进程

**触发信号**：纯音频应用的进程列表里出现 `utility:video_capture`。

**根因/约束**：Chromium 的 `mediaDevices` 会同时枚举**视频**设备，只要访问它（包括仅 `addEventListener('devicechange')`），就会拉起独立的 VideoCaptureService 进程并常驻至退出。播放器根本不需要视频采集能力。

**正确做法**：懒挂载。仅当用户确实配置了非默认音频输出设备时才注册 `devicechange` 监听 —— 该监听内部本就以 `deviceId === 'default'` 直接 return，懒挂载与原行为完全等价。设置页里的 `enumerateDevices()` 是用户主动行为，可以接受。

**验证方式**：实测进程数 7 → 6，省约 8.5 MB；配置中无 `playMusic.audioOutputDevice` 时 `video_capture` 不再出现。

**适用范围**：所有涉及音频输出设备选择的代码。

---

### 1.5 独立进程有固定成本，不要为轻量任务拆进程

**触发信号**：为了「崩溃隔离」而为逻辑很简单的模块创建独立进程。

**根因/约束**：每个独立进程都有运行时与 V8 堆基线。旧实现中 `requestForwarder` worker 只有 **28KB 代码，却占 16.1 MB**；该数值仅作历史参考。

**正确做法**：纯异步流式 I/O（如 HTTP 转发）通常不需要仅为避免阻塞而额外拆进程，应按当前运行时模型选择任务边界。

**合并后必须补的兜底**（否则未捕获异常会拖垮整个应用，这是失去崩溃隔离的真实代价）：

- `server.on('clientError')` → `socket.destroy()`
- `res.on('error')`（客户端提前断开）
- `targetRes.on('error')`（上游流中断）→ `clientRes.destroy()`
- `dispose()` 用 `closeAllConnections()`，音频是长连接，不能等它自然结束

**验证方式**：实测进程数减 1，`browser(main)` 仅 +2.8 MB，净省约 13 MB。

**适用范围**：独立进程的引入决策。

---

### 1.6 实测基线（AMD Radeon 核显 + 1920×1080，空载=已加载一首歌不操作）

上述 1.3 / 1.4 / 1.5 三项全部实施后的实测对比，**供未来重做时参考**：

| 进程                            | 优化前                | 优化后                | 变化      |
| ------------------------------- | --------------------- | --------------------- | --------- |
| gpu-process                     | 102.7                 | 70.3                  | **−32.4** |
| browser(main)                   | 35.7                  | 38.5                  | +2.8      |
| renderer                        | 36.1                  | 33.8                  | −2.3      |
| utility:node (requestForwarder) | 15.8                  | —                     | **−15.8** |
| utility:video_capture           | 8.5                   | —                     | **−8.5**  |
| utility:network                 | 6.8                   | 6.8                   | 0         |
| utility:audio                   | 5.4                   | 5.5                   | +0.1      |
| **合计**                        | **211.0 MB / 7 进程** | **154.9 MB / 5 进程** | **−27%**  |

注意 GPU 进程内存有波动（同一版本实测到过 102.7 与 128.8），对比时应多次测量取稳定值。

---

## 二、构建与打包

### 2.1 Vite renderer 的动态 import 与 chunk 行为

**触发信号**：把重依赖改成 `import()` 后，bundle 体积没变小。

**当前约束**：桌面端已统一使用 Tauri + Vite。renderer 的 chunk 拆分由 `vite.config.ts` 中的 Rollup/Vite 配置决定。

**正确做法**：即便不拆包，动态 import 仍有价值 —— 模块顶层代码不会在启动时执行，V8 不必立即编译。实测 `hls.js`（540KB，占 main_window 19%，但仅播放 HLS 时才用）改为动态 import 后，renderer 仍降约 2 MB。

**适用范围**：所有「体积大但低频使用」的渲染层依赖。

---

### 2.2 pnpm 版本与 engines 冲突时的构建绕过

**触发信号**：`pnpm package` 报 `ERR_PNPM_UNSUPPORTED_ENGINE`。

**根因/约束**：pnpm 执行脚本时可能先做依赖状态检查；当包管理器版本与现有 `node_modules` 不匹配时，检查可能要求重装依赖或在非交互环境失败。

**正确做法**：使用与 lockfile 和现有依赖目录匹配的 pnpm 版本；只需验证单个工具时，可直接运行 `node_modules` 中对应的 CLI，避免意外重装依赖。

---

### 2.3 Vite 构建必须定义编译期全局常量

**触发信号**：Tauri 版安装后白屏，控制台报 `ReferenceError: __DEV__ is not defined`，且没有任何 React 错误浮层（1.0.19 之前版本的根因）。

**根因/约束**：源码使用编译期常量 `__DEV__`。Vite 构建必须通过 `define` 替换，否则模块顶层求值会抛 ReferenceError 并导致白屏。

**正确做法**：

1. `vite.config.ts` 设置 `define: { __DEV__: JSON.stringify(mode !== 'production') }`（dev server 为 true，build 为 false）。
2. 三个 Vite 入口 HTML（`mainWindow.html` / `lyricWindow.html` / `minimodeWindow.html`）内联「启动早期兜底」脚本：在 `<head>` 中最先注册 `error` / `unhandledrejection` 监听，仅当 `#root` 仍为空时显示错误堆栈，React 挂载成功后自动移除。
3. 新增编译期全局常量时，确保 Vite `define` 配置和源码用法保持一致。

**验证方式**：`vite build` 后 `rg "__DEV__" dist/assets/*.js` 应为零匹配。

**适用范围**：本项目所有 Vite 构建期全局常量。

---

### 2.4 Tauri（WebView2）发布版白屏的远程调试定位法

**触发信号**：已安装的 Tauri 应用白屏，日志目录无输出（启动早期即崩溃，logger 还没跑起来）。

**根因/约束**：发布版无 DevTools 入口，白屏时看不到任何控制台信息，只能靠猜。

**正确做法**：

1. 启动应用前设置环境变量附加远程调试参数：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333 --remote-allow-origins=*'`。
2. 访问 `http://localhost:9333/json/list` 拿页面 target，用 CDP（`Runtime.enable` + `Log.enable` + `Page.reload`）抓取完整加载过程的控制台与未捕获异常堆栈。
3. 避开本机 Chrome 占用的 9222 等端口（Chrome 占 IPv4 时 WebView2 会退到 `[::1]` 监听，容易误判为"端口无响应"）。
4. 端到端验证修复产物（无需重新打包）：`vite build` + `vite preview` 后，用 CDP `Page.navigate` 把窗口导航到 preview 地址，即可用真实 Rust 后端跑修复后的前端产物。注意此时页面属于 remote origin，`plugin:event|listen` 等内核插件命令会因 ACL 被拒（预期现象，非 Bug）；自定义命令与数据链路不受影响。

**验证方式**：CDP 抓到 `[TauriBridge]` 日志序列与具体异常堆栈即定位成功；导航法能直接看到 UI 是否渲染（`#root` 子节点数）。

**自动化实测补充（2026-10-18）**：

1. CDP 驱动长流程（下载、轮询等）时，**页面内 `setTimeout` 在后台窗口会被 Chromium 节流**（约 1 分钟/跳），单条长表达式必然拖死；正确架构是「页面一步操作立即返回 + Node 侧轮询」（Node timer 不节流）。启动调试实例可加 `--disable-background-timer-throttling` 参数。
2. 插件搜索桥 `callPluginMethod({ method: 'search', args: [kw, page, type] })` 的 type 必须用 UI 的 `SearchMediaType`（`music`/`album`/`artist`/`sheet`），传洛雪规范的 `song` 会命中 searcher 空分支，**静默返回空数组**而非报错。
3. **remote origin 页面下 `fs_*` 系列自定义命令会被 ACL 直接拒绝**（报 `Command fs_read_file not allowed by ACL`），JsonFileStore 等容错层会静默降级为空数据——远程调试时「数据全空」优先怀疑 ACL 而非代码或路径（globalContext.appPath 等值本身正常）；数据类验证请在 tauri.localhost 页面进行，纯前端播放链路不受影响。
4. **命令行/CDP 实验里传 Windows 路径禁止手打反斜杠**：bash→JSON→JS 多层转义会把 `\\` 降级为 `\`，而 JS 非法转义序列（如 `\椒`）会静默丢弃反斜杠，产生 `E:椒盐音乐` 这类无效路径（报 os error 3 / 判定不存在），排查时极易误判为「盘符/权限问题」。正确做法：用 `String.fromCharCode(92)` 拼反斜杠，或直接从数据源（JSON 数据）取路径。

**适用范围**：所有 Tauri v2（WebView2）发布版的问题定位。

---

### 2.5 本机无 MSVC 工具链，Tauri 本地构建走 CI

**触发信号**：本地 `tauri build` 在链接阶段报 `link: extra operand '....rcgu.o'`。

**根因/约束**：本机未安装 Visual Studio / MSVC（`C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe` 不存在），rustup 只有 `x86_64-pc-windows-msvc` 工具链；且从 Git Bash 调起 cargo 时，rustc 会把 Git 自带的 GNU `link.exe`（coreutils 硬链接工具）当作 MSVC 链接器调用，报 `extra operand`。

**正确做法**：本地只做前端产物验证（`vite build` / `vite preview` + 2.7 的远程调试法）；完整 Tauri 安装包统一由 GitHub Actions（push v\* 标签触发 `tauri-build.yml`）构建，不要为本地构建硬装 VS。

**适用范围**：本项目所有本地构建/验证决策。

---

### 2.6 发版必须同步 release/version.json（应用内“更新公告”数据源）

**触发信号**：新版本已发布，但应用内「检查更新」提示的仍是旧版本（如 v1.0.19 已发布、公告内容停留在 1.0.16/1.0.18）。

**根因/约束**：`check_update` 读取仓库内 `release/version.json`（version/changeLog/download，经 raw / jsdelivr / gh-proxy 多镜像竞速拉取）。迁移到 Tauri 后由 tag 触发的 CI 自动发版不再包含手工公告同步，公告因此可能滞留旧版本。

**正确做法**：

1. 发版前把 `release/version.json` 的 version/changeLog 更新到目标版本；download 只保留 `https://anhe-player.loc.cc` 这一个官网下载入口，禁止改回 GitHub Release 资产直链。更新弹窗与“关于”中的官方网站共用 `OFFICIAL_SITE_URL`，弹窗不使用公告中的旧下载地址，避免国内用户被引导到受阻的 GitHub。
2. `tauri-build.yml` 已加入前置校验（tag 与 version.json.version 不一致直接构建失败）与发布说明生成步骤（Release body 由 version.json 的 changeLog 生成，单一数据源）。
3. Tauri 端 `check_update` 命令必须实现既有 UPDATE_SOURCES 拉取与版本比较逻辑，否则应用内根本不会展示更新公告。

**验证方式**：`curl -s https://raw.githubusercontent.com/raclen/AnhePlayer/master/release/version.json` 的 version 应与最新 tag 一致。

**适用范围**：所有正式发布流程。

---

### 2.7 Tauri 运行时版本必须从 tauri.conf.json 读取，发版前四处版本号同步

**触发信号**：应用已是最新版却弹「发现新版本」（2026-10-18 实测：应用自报 1.0.19，远端 version.json 已是 1.0.20）。

**根因/约束**：版本号有四个事实源：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`release/version.json`。发版时若漏改其中一个（本次漏 Cargo.toml），而运行时代码用 `env!("CARGO_PKG_VERSION")`（来自 Cargo.toml）自报版本，就会与安装包/远端不一致，更新检查误判为「有新版本」。

**正确做法**：

1. Rust 侧运行时版本一律取 `app.package_info().version`（源自 tauri.conf.json，与安装包对齐），不要用 `env!("CARGO_PKG_VERSION")` 作为对外展示版本。
2. 打标签前四处核对：`node -e` 读 package.json / release/version.json / tauri.conf.json，外加 grep Cargo.toml，必须全部等于目标版本。

**验证方式**：冒烟用例 app-version 回报目标版本号；四方核对命令输出一致。

**适用范围**：所有 Tauri 版发版与对外版本展示。

---

### 2.8 tauri-action 的 tagName 直接取 ref_name 会在 dispatch 构建误建同名标签与 Release

**触发信号**：`git push origin master` 报 `src refspec master matches more than one`；Releases 页出现以分支名（master）为名的 Release；远端多出 `refs/tags/master`。

**根因/约束**：workflow_dispatch 构建时 `github.ref_name` 是分支名；`tauri-action` 的 `tagName: ${{ github.ref_name }}` 会照单在远端创建同名 tag+Release，本地 IDE 自动 fetch 后出现同名 tag，与同名分支一起让短名 push 产生歧义。同类隐患：softprops 步骤 `|| 'v1.0.17'` 兜底，dispatch 勾选 release 会把新产物发到旧版本 Release（已一并移除，发版只由推标签触发）。

**正确做法**：

1. `tagName`/`releaseName` 仅标签构建传值：`${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}`；发布两步的条件也只看 `startsWith(github.ref, 'refs/tags/v')`。
2. 已被同名 tag 干扰时：`gh release delete master --yes --cleanup-tag` + `git tag -d master`；推送一律用显式 refspec（`refs/heads/master:refs/heads/master`）兜底。

**验证方式**：dispatch 构建后 `gh release list` 与 `git ls-remote --tags` 无分支名条目；标签构建正常发布且含 NSIS/MSI 资产。

**适用范围**：本项目所有 CI 构建与发版流程。

---

### 2.9 本地转发代理必须回写 CORS 头，否则页面侧 fetch 静默失败

**触发信号**：Tauri 版经 forwarder（127.0.0.1 随机端口）的请求在页面侧失败，但用 curl 请求同一代理 URL 返回 200 正常。

**根因/约束**：页面 origin 为 `tauri.localhost`，访问 127.0.0.1 代理属跨源请求；tiny_http 默认响应不带 `Access-Control-Allow-Origin`，浏览器 fetch 直接拒绝读取响应体。curl 不做 CORS 检查，外部测试无法暴露此问题。

**正确做法**：代理的成功与错误响应统一附加 `Access-Control-Allow-Origin: *`；此类功能必须页面内实测（CDP），不能只靠 curl。

**验证方式**：冒烟用例 forwarder-proxy-fetch 在页面内 fetch 代理 URL 返回 200 与正文。

**适用范围**：所有自建本地 HTTP 代理/转发服务。

---

### 2.10 本地媒体播放必须走 asset 协议，且 asset URL 禁止进转发代理

**触发信号**：Tauri 版本地歌曲/已下载歌曲点击播放无声或立即失败。

**根因/约束**：

1. 本地插件返回的播放 URL 是 `http://asset.localhost/...`（WebView2 内部拦截域名，Tauri asset 协议）；转发代理的 `isProxyRequired` 只按协议判断（http/https 一律代理），asset URL 被包进 Rust 转发代理后，reqwest 无法解析 `asset.localhost`，返回 502 `upstream failed`，播放必败（同一 URL 页面直连 fetch 是 200）。
2. 已下载歌曲的 URL 曾走 `file:///`：WebView2 禁止从 http 页面加载 file 资源，audio 报 `MEDIA_ERR_SRC_NOT_SUPPORTED`（error code 4）。

**正确做法**：

1. `isProxyRequired` 显式排除 `asset.localhost`（hostname 判断），asset URL 一律直连。
2. 本地路径 → 播放 URL 统一用 `fsUtil.pathToAssetUrl`（`convertFileSrc(path, 'asset')`），禁止用 `file:///`。

**验证方式**：CDP 里 `new Audio(assetUrl)` 可 loadedmetadata；`fetch(proxyUrl(assetUrl))` 复现 502；播放后 `navigator.mediaSession.playbackState === 'playing'`。

**适用范围**：所有 Tauri/WebView2 下的本地媒体播放与代理判断。

---

### 2.11 测试用例禁止调用「以输入集合为准做删除」的 API（本地库误清事故）

**触发信号**：本地音乐库突然清空（local-music.json 变成空库），但磁盘文件完好。

**根因/约束**：冒烟用例曾调用 `syncScanFolders([临时目录])`——该 API 语义是「以传入的文件夹集合为准做 diff」：不在集合里的既有文件夹及其全部曲目会被移除。当用户曲库已配置扫描文件夹时，用临时目录调用它 = 清空用户全部本地曲目记录。

**正确做法**：

1. 测试/脚本只用命令级原语（`local_scan_dir` / `local_parse_meta`），禁止调用会做「集合 diff 删除」的高层 API。
2. 本地曲目 id = `hashPath(filePath)`（路径稳定哈希）：误清后重新 `syncScanFolders([原文件夹])` 即可恢复，且 **id 与恢复前一致**，歌单/收藏/最近播放的引用自动复原（实测 201 首全量恢复、抽样 id 一致）。

**验证方式**：恢复后 `getAllMusicItems()` 数量与抽样 id 与事故前一致。

**适用范围**：所有涉及用户数据的高层 API 的测试设计。

---

## 三、架构决策

### 3.1 桌面端统一使用 Tauri v2

**决策**：旧桌面运行时代码、依赖、原生模块和独立打包链路已移除；桌面端只维护 Tauri v2 + Rust 与 Vite/React 前端。

**保留能力**：LX Music 插件继续由前端 Web Worker 沙箱执行；文件、窗口、下载和系统集成能力由 Rust commands 与 Tauri plugins 提供。不要重新引入旧桌面运行时的主进程、preload 或独立打包链路。

---

## 四、已知问题（非本次引入）

- `components/ui/MediaGrid` 用裸 `data.map` 渲染，未做虚拟化（`SongTable`/`QueueDrawer` 已用 react-virtuoso）；被 ArtistPage / RecommendSheetsPage / SearchPage 使用，结果集大时是内存隐患。
- `i18next` 在 renderer bundle 中被打了两份（CJS + ESM 各一，约 240 KB），移除 asset-relocator 后依旧，原因未定位。
