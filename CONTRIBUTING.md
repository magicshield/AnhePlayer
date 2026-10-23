# 贡献指南 | Contributing Guide

## 开发环境 | Development Setup

|  依赖   |  版本  |
| :-----: | :----: |
| Node.js |  22.x  |
|  pnpm   |   9+   |
|  Rust   | Stable |
|   Git   | Latest |

Windows 桌面开发还需要 Visual Studio C++ Build Tools 与 WebView2 Runtime。

安装依赖后运行 pnpm tauri:dev 启动开发环境。

## 提交流程 | Contribution Workflow

提交前运行 pnpm run lint、pnpm run format:check 和 pnpm tauri:build。

项目配置了 Husky 与 lint-staged，提交时会自动执行格式化和检查。

## 代码规范 | Code Style

- 使用 TypeScript 编写界面与业务代码
- Rust 桌面能力放在 src-tauri/
- 前端通过 src/infra/tauriBridge/ 调用系统能力
- 保持改动聚焦，并为行为变化提供验证说明

## 提交规范 | Commit Convention

推荐使用 Conventional Commits，例如 feat(plugin): support plugin import、fix(player): resolve playback issue、docs(readme): update development commands。

## 项目架构 | Project Architecture

- src/renderer/：React 主窗口、桌面歌词和迷你模式界面
- src/infra/：业务模块和 Tauri bridge
- src-tauri/：Tauri v2 Rust 宿主
- res/：语言包、主题及其他资源

桌面应用只有 Tauri + Rust 一套运行链路。界面使用 React、TypeScript、Vite，状态管理使用 Jotai。
