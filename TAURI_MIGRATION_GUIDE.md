# Tauri v2 架构与开发指南

AnhePlayer 桌面端使用单一 Tauri v2 + Rust 运行链路，界面由 React、TypeScript 和 Vite 构建。

## 架构

- [96msrc/renderer/[0m：主窗口、桌面歌词和迷你模式界面
- [96msrc/infra/[0m：业务逻辑、插件 Worker 与 Tauri bridge
- [96msrc-tauri/[0m：Rust 宿主、系统命令和窗口配置
- [96mres/[0m：语言包、主题及资源

前端通过 [96mtauriInvoke[0m 和 Tauri 插件调用 Rust/系统能力。插件脚本在 Web Worker 中运行。

## 环境与命令

Windows 开发需要 Node.js 22、pnpm 9+、Rust 工具链、Visual Studio C++ Build Tools 与 WebView2 Runtime。

- [96mpnpm tauri:dev[0m：启动开发环境
- [96mpnpm run lint[0m：运行 ESLint
- [96mpnpm run format:check[0m：检查格式
- [96mpnpm tauri:build[0m：构建桌面安装包

## 手工验证范围

- 主窗口、歌词窗口和迷你模式的打开、关闭及切换
- 设置与配置重启持久化
- 插件导入、初始化、歌曲解析与播放
- 本地音乐扫描、播放、下载、备份与恢复
- 托盘、系统快捷键与外部链接
