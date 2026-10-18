# AnhePlayer — Electron 迁移至 Tauri v2 重构与适配指南

## 1. 架构改造总览 (Architecture Overview)

本项目已完成从原生 Electron 强耦合架构向 **Electron / Tauri v2 双轨适配架构** 的全量重构。

```
                    ┌──────────────────────────────────────────┐
                    │      React 渲染层 (UI / Hooks / Jotai)   │
                    │ (零感知、零侵入，维持 contextBridge 调用)│
                    └─────────────────────┬────────────────────┘
                                          │
                        window[CONTEXT_BRIDGE_KEY]
                                          │
               ┌──────────────────────────┴──────────────────────────┐
               ▼                                                     ▼
     [Electron 运行时]                                         [Tauri v2 运行时]
  Electron Preload 注入                                   TauriBridge 前端适配层
  (Node.js / IPC Renderer)                          (window.__TAURI_INTERNALS__)
               │                                                     │
               ▼                                                     ▼
     Electron 主进程                                            src-tauri
   (Node.js / C++ 原生)                                     (Rust 核心轻量进程)
```

---

## 2. 核心适配模块清单

### 2.1 前端 ContextBridge 适配层 (`src/infra/tauriBridge/`)
- `isTauri.ts`: 精确识别 Tauri 运行环境（检测 `__TAURI_INTERNALS__` 或 `__TAURI__` 全局标志）。
- `ipc.ts`: 封装底层 Tauri IPC 调用（`invoke`、`listen`、`emit`）。
- `bridges/appConfig.ts`: 桥接配置读取、持久化与更新监听。
- `bridges/globalContext.ts`: 注入系统常用路径（下载目录、临时目录、用户配置目录）。
- `bridges/systemUtil.ts`: 窗口最大化/最小化/关闭/迷你模式切换、系统外部链接打开。
- `bridges/fsUtil.ts`: 文件读写、创建目录、删除、遍历等。
- `bridges/commonBridges.ts`: 日志系统、国际化语言包、全局快捷键、主题包管理桥接。
- `bridges/dataBridges.ts`: 歌单持久化 (`musicSheet`)、播放队列、媒体元数据 (`mediaMeta`)、下载管理 (`downloadManager`)、本地音乐扫描 (`localMusic`)、数据导入导出 (`backup`)。
- `bridges/pluginManagerBridge.ts`: 插件管理与音源解析桥接。

### 2.2 洛雪音源插件前端沙箱引擎 (`src/infra/pluginManager/worker/`)
- 传统方案在 Node.js `vm.createContext` 中执行，依赖 C++ 及 Node 原生运行时。
- **全新重构方案（参考 anhe-downloader）**：
  - `webWorkerSandbox.ts`: 前端 Web Worker 隔离沙箱，模拟完整 `globalThis.lx` 运行上下文（事件驱动、请求响应模型）。
  - `pluginWorkerHost.ts`: 宿主通信管理器，拦截插件发起的网络请求，调用 Tauri 后端 `http_request` 绕过 CORS 与防盗链限制。

### 2.3 Rust 核心架构骨架 (`src-tauri/`)
- `Cargo.toml`: 配置 Tauri 2.0、`tauri-plugin-opener`、`tauri-plugin-http`、`reqwest`、`tokio`。
- `tauri.conf.json`: 完整配置多窗口模式：
  - `main`: 主播放器窗口（自定义标题栏）。
  - `lyric`: 桌面歌词悬浮窗（置顶、透明、无边框）。
  - `minimode`: 迷你播放器悬浮窗（透明、无边框）。
- `capabilities/default.json`: Tauri v2 安全权限声明（启用 core、opener、http）。
- `src/commands/`:
  - `global_context.rs`: 操作系统路径与平台检测。
  - `app_config.rs`: JSON 配置读写。
  - `system_util.rs`: 窗口控制与 Explorer 文件定位。
  - `fs_util.rs`: 文件系统安全操作。
  - `http_proxy.rs`: 高性能无 CORS HTTP 代理。
  - `plugin_store.rs`: 本地音源脚本持久化存储。

---

## 3. 运行与编译指引 (How to Run & Build)

### 3.1 前提依赖准备 (Windows)
1. **安装 Rust 工具链**：
   - 访问 [https://rustup.rs/](https://rustup.rs/) 下载 `rustup-init.exe` 并安装（选择默认选项 1）。
2. **安装 Visual Studio C++ 生成工具**：
   - 安装 Visual Studio Community 或 Build Tools for Visual Studio，勾选 **“使用 C++ 的桌面开发”** (Desktop development with C++)。
3. **安装 WebView2 运行时**（Win10/Win11 通常系统自带）。

### 3.2 启动开发环境

```bash
# 启动 Tauri v2 开发调试 (启动 Vite 前端服务 + Rust 宿主)
pnpm tauri:dev
```

### 3.3 构建发布安装包

```bash
# 打包生成轻量级 Windows 安装程序 (MSI / EXE)
pnpm tauri:build
```

---

## 4. 迁移验证 Checklist (测试与联调项)

- [ ] **窗口能力**：
  - [ ] 主窗口最大化、还原、最小化、关闭功能正常。
  - [ ] 切换至迷你模式窗口与恢复正常主窗口。
  - [ ] 桌面歌词窗口呼出、透明背景与置顶状态渲染。
- [ ] **配置与持久化**：
  - [ ] 设置页面中修改配置（下载路径、播放设置、常规设置）能够正常持久化并在重启后保留。
- [ ] **洛雪音源插件**：
  - [ ] 本地导入 `.js` 洛雪音源插件或通过网络 URL 导入。
  - [ ] Web Worker 沙箱正常初始化音源并在控制台打印 `inited`。
  - [ ] 点击歌曲播放时，Worker 发送 `lx_request` 并由 Rust HTTP 代理正确返回直链播放。
  - [ ] 桌面歌词与逐字歌词解析渲染。
- [ ] **文件系统**：
  - [ ] 点击“在文件夹中显示”能唤起 Windows Explorer 定位文件。
  - [ ] 本地音乐扫描能够读取指定文件夹下的音轨。
