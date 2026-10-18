# PROJECT_RULES.md

> 记录本项目**长期有效、可复用**的经验、踩坑、约束与关键决策。
> 只记录值得长期记住的内容；一次性需求与临时方案不入册。

---

## 一、性能与内存

### 1.1 Electron 内存分析必须按进程分解实测，禁止凭直觉优化

**触发信号**：有人反馈「空载内存占用高」「内存能不能优化」。

**根因/约束**：Electron 是多进程架构，任务管理器里的父项是所有子进程 **专用工作集（Private Working Set）** 之和。不同进程的内存成因和优化手段完全不同，凭直觉猜测几乎必然指向错误方向。

**正确做法**：先分解，再决策。

```powershell
$perf = @{}
Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $perf[[int]$_.IDProcess] = $_.WorkingSetPrivate }
Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*anhe*' } | ForEach-Object {
  $cl = [string]$_.CommandLine; $t = 'browser(main)'
  if ($cl -match '--type=([a-zA-Z-]+)') { $t = $Matches[1] }
  if ($cl -match '--utility-sub-type=([a-zA-Z0-9._]+)') { $t = $t + ':' + ($Matches[1] -replace '\.mojom\..*','') }
  New-Object PSObject -Property @{ Role = $t; MB = [math]::Round($perf[[int]$_.ProcessId]/1MB,1) }
} | Sort-Object MB -Descending | Format-Table -AutoSize
```

**验证方式**：各进程 `WorkingSetPrivate` 之和应约等于任务管理器显示的数字（实测 240.8MB vs 244.5MB，吻合）。
注意 `WorkingSet64` 含共享内存，会虚高 2~3 倍（实测总和 737MB），**不要用它下结论**。

**适用范围**：任何 Electron 内存问题。

---

### 1.2 GPU 进程内存高不等于代码有问题 —— 先做同机横向对比

**触发信号**：GPU 进程占了总内存的一半，第一反应是「GPU 有问题」。

**根因/约束**：GPU 进程内存里有很大一块是显卡驱动（ANGLE/D3D11）的固定开销，**与应用代码无关**。在集显机器上尤其明显：没有独立显存，纹理全部从系统内存分配，本该进 VRAM 的开销会直接计入进程内存。

**正确做法**：在**同一台机器**上对比其他 Chromium 应用的 GPU 进程，再判断是否异常。

实测基线（AMD Radeon 核显，1920×1080）：

| 应用 | GPU 进程专用内存 |
|---|---|
| Chrome | 251 MB |
| VS Code | 225 MB |
| QQ | 115 MB |
| **AnhePlayer** | **103~128 MB** |
| Edge WebView2 | 79 MB |

结论：本项目 GPU 进程处于正常偏低水平，**不要把精力投在「压缩 GPU 进程」这个方向**。但这不代表 GPU 里没有可优化项 —— 见 1.3。

**适用范围**：所有 Electron/Chromium 应用的 GPU 内存判断。

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

### 1.5 utilityProcess 的固定成本约 16MB，不要为轻量任务开进程

**触发信号**：为了「崩溃隔离」而 `utilityProcess.fork` 一个逻辑很简单的模块。

**根因/约束**：每个 `utilityProcess` 都是完整的 Node 进程，自带一份 V8 堆基线。实测 `requestForwarder` 的 worker 只有 **28KB 代码，却占 16.1 MB**。

**正确做法**：纯异步流式 I/O（如 HTTP 转发的 `pipe`）不会阻塞主进程事件循环，也不影响 UI（UI 在渲染进程），放主进程即可。

**合并后必须补的兜底**（否则未捕获异常会拖垮整个应用，这是失去崩溃隔离的真实代价）：
- `server.on('clientError')` → `socket.destroy()`
- `res.on('error')`（客户端提前断开）
- `targetRes.on('error')`（上游流中断）→ `clientRes.destroy()`
- `dispose()` 用 `closeAllConnections()`，音频是长连接，不能等它自然结束

**验证方式**：实测进程数减 1，`browser(main)` 仅 +2.8 MB，净省约 13 MB。

**适用范围**：任何 utilityProcess / child_process 的引入决策。

---

### 1.6 实测基线（AMD Radeon 核显 + 1920×1080，空载=已加载一首歌不操作）

上述 1.3 / 1.4 / 1.5 三项全部实施后的实测对比，**供未来重做时参考**：

| 进程 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| gpu-process | 102.7 | 70.3 | **−32.4** |
| browser(main) | 35.7 | 38.5 | +2.8 |
| renderer | 36.1 | 33.8 | −2.3 |
| utility:node (requestForwarder) | 15.8 | — | **−15.8** |
| utility:video_capture | 8.5 | — | **−8.5** |
| utility:network | 6.8 | 6.8 | 0 |
| utility:audio | 5.4 | 5.5 | +0.1 |
| **合计** | **211.0 MB / 7 进程** | **154.9 MB / 5 进程** | **−27%** |

注意 GPU 进程内存有波动（同一版本实测到过 102.7 与 128.8），对比时应多次测量取稳定值。

---

## 二、构建与打包

### 2.1 lucide-react 无法 tree-shaking —— 根因不是 loader 配置

**触发信号**：bundle 里有 1600+ 个图标，源码实际只用几十个（占 main_window 约 16%，占 lyric/minimode 各约 46%）。

**根因/约束**：出在 lucide-react 自身入口 `dist/esm/lucide-react.js`：

```js
import * as index from './icons/index.js';
export { index as icons };
```

命名空间再导出让 webpack 无法证明那 1600 个图标未被使用。

**已排除的错误假设**（重要，别再走一遍）：曾怀疑是 `webpack.rules.ts` 里 `@vercel/webpack-asset-relocator-loader` 匹配了 `node_modules` 下所有 `.js`、破坏 ESM 静态分析所致。**已实测证伪**：把 renderer/preload 的规则拆出该 loader 后重新构建，main_window bundle 仅从 2,826,587 减到 2,825,378 字节（1209 字节），sourcemap 显示 lucide 的 1691 个源文件仍全部走 ESM 且全部被打包。构建 mode 也确认是 production（react-dom 走 `production.js`）。

**若要修**：webpack alias 把 `lucide-react` 指向自建 shim（`export * from 'lucide-react/dist/esm/icons/index.js'` + 单独 re-export `createLucideIcon`），但必须手工补齐 9 个向后兼容别名 —— `icons/index.js` 里**没有**它们：

`Fingerprint`、`Loader2`、`MoreHorizontal`、`AlertCircle`、`AlertTriangle`、`HelpCircle`、`ArrowUpCircle`、`PlayCircle`、`Mic2`

**权衡（当前结论：不做）**：未使用的图标从不执行，V8 只做预解析，**对内存影响很小**，收益主要在体积与启动速度；而漏补别名会导致图标静默变成 `undefined`，且每次升级 lucide 都要重新核对。风险大于收益。

**验证方式**：`node -e` 解析 `index.js.map` 的 `sources`，统计含 `lucide-react` 的条目数（未修复时约 1691）。

---

### 2.2 renderer 不产出异步 chunk，动态 import 不会拆包但仍省内存

**触发信号**：把重依赖改成 `import()` 后，bundle 体积没变小。

**根因/约束**：electron-forge 的 webpack plugin 对 renderer 的配置不产出编号 chunk 文件（对比 `main/` 目录有 `521.js`/`704.js`），三个 entry 也没有 `splitChunks`，各自全量独立打包。

**正确做法**：即便不拆包，动态 import 仍有价值 —— 模块顶层代码不会在启动时执行，V8 不必立即编译。实测 `hls.js`（540KB，占 main_window 19%，但仅播放 HLS 时才用）改为动态 import 后，renderer 仍降约 2 MB。

**适用范围**：所有「体积大但低频使用」的渲染层依赖。

---

### 2.3 打包体积：可删清单与**禁止删除**清单

产物构成（win32-x64，306 MB）：

| 文件 | 体积 | 处置 |
|---|---|---|
| `anhe-player.exe` | 203.7 MB (67%) | 动不了，Electron 本体 |
| `dxcompiler.dll` + `dxil.dll` | **25.8 MB** | **可删**，见下 |
| `LICENSES.chromium.html` | 15.2 MB | **禁删**，BSD 许可要求 |
| `resources/app.asar` | 18 MB | 业务代码 |
| `icudtl.dat` | 10.3 MB | 需重编 Electron 才能裁剪，不值 |
| `libGLESv2.dll` + `d3dcompiler_47.dll` | 12.2 MB | ANGLE 必需 |
| `resources.pak` | 6.1 MB | 必需 |
| `vk_swiftshader.dll` + `vulkan-1.dll` | 6.3 MB | **禁删**，见下 |
| `ffmpeg.dll` | 2.9 MB | 播放器必需 |

**`dxcompiler.dll` / `dxil.dll` 可删**：它们是 WebGPU (Dawn) 专用的 DirectX Shader Compiler。本项目已 grep 确认**零 WebGPU / 零 WebGL** 调用（全项目仅 `themepack/preload/main.ts` 一处 canvas 2D 用于取封面主色），不加载即死重量。删除后实测应用正常启动运行。用 `forge.config.ts` 的 `postPackage` hook 删除。

**`vk_swiftshader.dll` / `vulkan-1.dll` 禁删**：这是软件渲染 fallback。`src/main/index.ts` 有 GPU 崩溃后 `disableHardwareAcceleration()` 的降级逻辑，降级后正是靠 SwiftShader 兜底；远程桌面 / 虚拟显示适配器场景同样依赖它。省 6MB 换白屏风险，不划算。

---

### 2.4 `scripts/optimize-package.mjs` 必须接入 postPackage hook

**触发信号**：直接产物 325 MB，但记忆中的产物是 306 MB，「改小了反而变大」。

**根因/约束**：项目自带的 `scripts/optimize-package.mjs`（裁剪多余语言包、清理 `.map`/README/docs/tests 残留，实测 **44.34 MB**）**从未被 package.json 的 scripts 引用**，只能手动执行。于是「手动优化过的旧产物」与「新构建的原始产物」被拿来直接对比，得出完全错误的结论。

**正确做法**：
1. 把它挂到 `forge.config.ts` 的 `hooks.postPackage` 里，与 dxcompiler 删除放一起，让 `pnpm package` / `make` 自动执行。
2. **更普适的教训：做任何前后对比前，先确认两边经过了完全相同的处理步骤。** 基线不可比时，所有结论都是错的。

**验证方式**：hook 生效时构建日志会输出 `[package-optimize] removed 53 entries, saved 44.34 MB`；`locales/` 应只剩 `en-US.pak` + `zh-CN.pak`（约 1.1 MB）。

---

### 2.5 pnpm 版本与 engines 冲突时的构建绕过

**触发信号**：`pnpm package` 报 `ERR_PNPM_UNSUPPORTED_ENGINE`。

**根因/约束**：`package.json` 的 `engines.pnpm` 限定 `>=9 <10`，而 pnpm 10+ 在执行 script 前会自动跑依赖检查（`runDepsStatusCheck` → `pnpm install`），该检查撞上 engines 限制直接失败。这与代码改动无关。

**正确做法**：绕过 pnpm 的 script 包装，直接调 forge：

```bash
NODE_ENV=production npx electron-forge package
```

**pnpm 11 补充（2026-10 实测）**：pnpm 11.9.0 下 `pnpm run <script>` 的依赖状态预检会因 node_modules 由 pnpm 9 创建而要求整目录重装，非 TTY 环境直接报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`（而非 10 的 engines 报错）。绕过方式：用 `npx -y pnpm@9 <command>`（与 CI 一致）执行脚本，或直接调 `node_modules/.bin/<工具>` 绕过 pnpm 包装。

---

### 2.6 双轨构建（Electron/webpack 与 Tauri/Vite）必须对齐编译期全局常量

**触发信号**：Tauri 版安装后白屏，控制台报 `ReferenceError: __DEV__ is not defined`，且没有任何 React 错误浮层（1.0.19 之前版本的根因）。

**根因/约束**：源码中使用了 webpack `DefinePlugin` 的编译期常量（`config/webpack.plugins.ts` 定义 `__DEV__`），Electron 构建正常替换；Vite 构建未配置对应 `define`，常量在产物中裸奔，模块顶层求值时（如 `router.tsx` 路由数组的 `...(__DEV__ ? [...] : [])`）直接抛 ReferenceError，入口模块图整体中断 → 白屏。入口文件内的错误浮层注册在模块体内，模块图中断时根本来不及执行，所以接不到这类错误。

**正确做法**：
1. `vite.config.ts` 与 webpack 语义对齐：`define: { __DEV__: JSON.stringify(mode !== 'production') }`（dev server 为 true，build 为 false）。
2. 三个 Vite 入口 HTML（`mainWindow.html` / `lyricWindow.html` / `minimodeWindow.html`）内联「启动早期兜底」脚本：在 `<head>` 中最先注册 `error` / `unhandledrejection` 监听，仅当 `#root` 仍为空时显示错误堆栈，React 挂载成功后自动移除。
3. **新增任何 webpack `DefinePlugin` 常量时，必须同步补 Vite `define`**；反之亦然。

**验证方式**：`vite build` 后 `rg "__DEV__" dist/assets/*.js` 应为零匹配。

**适用范围**：本项目所有「Electron + Tauri 双轨」构建期差异。

---

### 2.7 Tauri（WebView2）发布版白屏的远程调试定位法

**触发信号**：已安装的 Tauri 应用白屏，日志目录无输出（启动早期即崩溃，logger 还没跑起来）。

**根因/约束**：发布版无 DevTools 入口，白屏时看不到任何控制台信息，只能靠猜。

**正确做法**：
1. 启动应用前设置环境变量附加远程调试参数：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333 --remote-allow-origins=*'`。
2. 访问 `http://localhost:9333/json/list` 拿页面 target，用 CDP（`Runtime.enable` + `Log.enable` + `Page.reload`）抓取完整加载过程的控制台与未捕获异常堆栈。
3. 避开本机 Chrome 占用的 9222 等端口（Chrome 占 IPv4 时 WebView2 会退到 `[::1]` 监听，容易误判为"端口无响应"）。
4. 端到端验证修复产物（无需重新打包）：`vite build` + `vite preview` 后，用 CDP `Page.navigate` 把窗口导航到 preview 地址，即可用真实 Rust 后端跑修复后的前端产物。注意此时页面属于 remote origin，`plugin:event|listen` 等内核插件命令会因 ACL 被拒（预期现象，非 Bug）；自定义命令与数据链路不受影响。

**验证方式**：CDP 抓到 `[TauriBridge]` 日志序列与具体异常堆栈即定位成功；导航法能直接看到 UI 是否渲染（`#root` 子节点数）。

**适用范围**：所有 Tauri v2（WebView2）发布版的问题定位。

---

### 2.8 本机无 MSVC 工具链，Tauri 本地构建走 CI

**触发信号**：本地 `tauri build` 在链接阶段报 `link: extra operand '....rcgu.o'`。

**根因/约束**：本机未安装 Visual Studio / MSVC（`C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe` 不存在），rustup 只有 `x86_64-pc-windows-msvc` 工具链；且从 Git Bash 调起 cargo 时，rustc 会把 Git 自带的 GNU `link.exe`（coreutils 硬链接工具）当作 MSVC 链接器调用，报 `extra operand`。

**正确做法**：本地只做前端产物验证（`vite build` / `vite preview` + 2.7 的远程调试法）；完整 Tauri 安装包统一由 GitHub Actions（push v* 标签触发 `tauri-build.yml`）构建，不要为本地构建硬装 VS。

**适用范围**：本项目所有本地构建/验证决策。

---

### 2.9 发版必须同步 release/version.json（应用内“更新公告”数据源）

**触发信号**：新版本已发布，但应用内「检查更新」提示的仍是旧版本（如 v1.0.19 已发布、公告内容停留在 1.0.16/1.0.18）。

**根因/约束**：`check_update` 读取仓库内 `release/version.json`（version/changeLog/download，经 raw / jsdelivr / gh-proxy 多镜像竞速拉取）。Electron 时代每次 `chore: prepare X release` 都会同步更新该文件；迁移 Tauri 后由 tag 触发的 CI 自动发版不再包含这一步，公告因此滞留旧版本。

**正确做法**：
1. 发版前把 `release/version.json` 的 version/changeLog/download 更新到目标版本，download 指向对应 tag 的 GitHub Release 资产地址。
2. `tauri-build.yml` 已加入前置校验（tag 与 version.json.version 不一致直接构建失败）与发布说明生成步骤（Release body 由 version.json 的 changeLog 生成，单一数据源）。
3. Tauri 端 `check_update` 命令必须实现与 Electron 相同的 UPDATE_SOURCES 拉取与版本比较逻辑，否则应用内根本不会展示更新公告。

**验证方式**：`curl -s https://raw.githubusercontent.com/raclen/AnhePlayer/master/release/version.json` 的 version 应与最新 tag 一致。

**适用范围**：所有正式发布流程。

---

### 2.10 Tauri 运行时版本必须从 tauri.conf.json 读取，发版前四处版本号同步

**触发信号**：应用已是最新版却弹「发现新版本」（2026-10-18 实测：应用自报 1.0.19，远端 version.json 已是 1.0.20）。

**根因/约束**：版本号有四个事实源：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`release/version.json`。发版时若漏改其中一个（本次漏 Cargo.toml），而运行时代码用 `env!("CARGO_PKG_VERSION")`（来自 Cargo.toml）自报版本，就会与安装包/远端不一致，更新检查误判为「有新版本」。

**正确做法**：
1. Rust 侧运行时版本一律取 `app.package_info().version`（源自 tauri.conf.json，与安装包对齐），不要用 `env!("CARGO_PKG_VERSION")` 作为对外展示版本。
2. 打标签前四处核对：`node -e` 读 package.json / release/version.json / tauri.conf.json，外加 grep Cargo.toml，必须全部等于目标版本。

**验证方式**：冒烟用例 app-version 回报目标版本号；四方核对命令输出一致。

**适用范围**：所有 Tauri 版发版与对外版本展示。

---

### 2.11 tauri-action 的 tagName 直接取 ref_name 会在 dispatch 构建误建同名标签与 Release

**触发信号**：`git push origin master` 报 `src refspec master matches more than one`；Releases 页出现以分支名（master）为名的 Release；远端多出 `refs/tags/master`。

**根因/约束**：workflow_dispatch 构建时 `github.ref_name` 是分支名；`tauri-action` 的 `tagName: ${{ github.ref_name }}` 会照单在远端创建同名 tag+Release，本地 IDE 自动 fetch 后出现同名 tag，与同名分支一起让短名 push 产生歧义。同类隐患：softprops 步骤 `|| 'v1.0.17'` 兜底，dispatch 勾选 release 会把新产物发到旧版本 Release（已一并移除，发版只由推标签触发）。

**正确做法**：
1. `tagName`/`releaseName` 仅标签构建传值：`${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}`；发布两步的条件也只看 `startsWith(github.ref, 'refs/tags/v')`。
2. 已被同名 tag 干扰时：`gh release delete master --yes --cleanup-tag` + `git tag -d master`；推送一律用显式 refspec（`refs/heads/master:refs/heads/master`）兜底。

**验证方式**：dispatch 构建后 `gh release list` 与 `git ls-remote --tags` 无分支名条目；标签构建正常发布且含 NSIS/MSI 资产。

**适用范围**：本项目所有 CI 构建与发版流程。

---

### 2.12 本地转发代理必须回写 CORS 头，否则页面侧 fetch 静默失败

**触发信号**：Tauri 版经 forwarder（127.0.0.1 随机端口）的请求在页面侧失败，但用 curl 请求同一代理 URL 返回 200 正常。

**根因/约束**：页面 origin 为 `tauri.localhost`，访问 127.0.0.1 代理属跨源请求；tiny_http 默认响应不带 `Access-Control-Allow-Origin`，浏览器 fetch 直接拒绝读取响应体。curl 不做 CORS 检查，外部测试无法暴露此问题。

**正确做法**：代理的成功与错误响应统一附加 `Access-Control-Allow-Origin: *`；此类功能必须页面内实测（CDP），不能只靠 curl。

**验证方式**：冒烟用例 forwarder-proxy-fetch 在页面内 fetch 代理 URL 返回 200 与正文。

**适用范围**：所有自建本地 HTTP 代理/转发服务。

---

## 三、架构决策

### 3.1 不迁移到 Tauri

**触发信号**：为了减小体积/内存，考虑换 Tauri 等复用系统 WebView 的方案。

**结论与依据**（基于同机 WebView2 实测，非估算）：

- **体积**：306 MB → 约 12~18 MB（**−95%**），这是真实且巨大的收益。
- **内存**：244 MB → 约 130~165 MB（**仅 −30%**）。因为 WebView2 同样是 Chromium：实测单个活跃 WebView2 应用为 gpu 61 MB + renderer 65.9 MB + browser 17.5 MB + 其他 5.1 MB。**GPU 与渲染进程的开销一分不少**，真正省下的只有 Electron 主进程（36 MB → Rust 5~15 MB）和 requestForwarder 进程（15.8 MB）。

**否决的关键理由**：

1. **插件生态会归零**。本项目兼容 LX Music 格式插件，是**高度混淆的第三方 JS**（入口 `globalThis.lx` 的 `{EVENT_NAMES, request, on, send}`），作者不会为迁移重写。Rust 端没有 JS 引擎：嵌 deno_core/V8 等于把体积和内存优势还回去；用 QuickJS 则要赌混淆代码的引擎兼容性。即便改走「插件在 WebView2 前端跑、网络请求 invoke 到 Rust 绕 CORS」，也要重写整套 2300+ 行的 `pluginSandbox.ts`，且兼容性只能逐个插件试。
2. **音频编解码不可控**。Electron 自带 `ffmpeg.dll`，支持哪些格式由项目决定；WebView2 用系统 Edge 的编解码器，FLAC/APE/DSD 等无损格式的支持度随 Edge 自动更新变化，出问题无回滚余地。对播放器是致命风险。
3. 工作量约 3~6 个月（数据库、元数据解析、下载、备份、同步、托盘、缩略图工具栏全部 Rust 重写），`native_modules/` 下的 CustomTrayMenu、TaskbarManager 需 Rust FFI 重做，`setSinkId` 在 WebView2 的支持度还需验证。

**若体积确为核心诉求**，优先做：删 dxcompiler（−26 MB）+ 接入 optimize-package（−44 MB）+ 差分更新（让更新包降到几 MB）。

---

## 四、已知问题（非本次引入）

- `src/infra/downloadManager/` 有 4 处 ESLint 报错：`downloadTask.ts:15` 未使用的 `nodeID3`、`index.ts:14` 未使用的 `fs`、`index.ts:934/969` 的 `require()` 风格导入。
- `pluginManager` 的 `dispose()` 是空实现，插件的 vm context 加载后**永不释放**，是主进程内唯一随用户数据线性增长的部分。
- `components/ui/MediaGrid` 用裸 `data.map` 渲染，未做虚拟化（`SongTable`/`QueueDrawer` 已用 react-virtuoso）；被 ArtistPage / RecommendSheetsPage / SearchPage 使用，结果集大时是内存隐患。
- `i18next` 在 renderer bundle 中被打了两份（CJS + ESM 各一，约 240 KB），移除 asset-relocator 后依旧，原因未定位。
