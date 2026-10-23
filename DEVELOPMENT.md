# AnhePlayer 开发指南

AnhePlayer 使用 React、TypeScript、Vite 和 Tauri v2。桌面端只有一套 Tauri + Rust 运行链路。

## 环境要求

- Node.js 22
- pnpm 9 或更新版本
- Rust 工具链
- Windows 开发/打包需要 Visual Studio C++ Build Tools 与 WebView2 Runtime

## 安装与启动

运行 pnpm install 安装依赖，再运行 pnpm tauri:dev 启动 Vite 前端开发服务器和 Tauri Rust 宿主。

## 检查与构建

- pnpm run lint：检查代码
- pnpm run format:check：检查格式
- pnpm tauri:build：构建桌面安装包
- pnpm run build:tauri-prepare：仅构建前端资源

## 目录结构

- src/renderer/：React 窗口与界面
- src/infra/：业务基础设施和 Tauri 前端桥接
- src-tauri/：Rust 宿主、系统能力和 Tauri 配置
- res/：语言包、主题和应用资源
- .github/workflows/tauri-build.yml：Tauri CI 构建与发布

正式发布由 v\* 标签触发的 Tauri workflow 负责。版本更新需遵循项目发布流程并同步版本源。
