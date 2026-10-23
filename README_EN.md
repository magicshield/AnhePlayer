<div align="center">

<img src="./res/logo.svg" width="96" height="96" alt="Anhe Player logo" />

# Anhe Player

A modern, lightweight desktop music player tailored for Windows with LX sound source plugin support.

English | [简体中文](./README.md)

[![License](https://img.shields.io/github/license/raclen/AnhePlayer?style=flat&color=blue)](./LICENSE)
[![Version](https://img.shields.io/github/package-json/v/raclen/AnhePlayer?style=flat&color=orange)](./package.json)
[![Release](https://img.shields.io/github/v/release/raclen/AnhePlayer?style=flat&color=green)](https://github.com/raclen/AnhePlayer/releases)
[![Downloads](https://img.shields.io/github/downloads/raclen/AnhePlayer/total?style=flat&color=brightgreen)](https://github.com/raclen/AnhePlayer/releases)
[![Stars](https://img.shields.io/github/stars/raclen/AnhePlayer?style=flat&color=yellow)](https://github.com/raclen/AnhePlayer/stargazers)

</div>

## Overview

Anhe Player is a modern desktop music player built exclusively for Windows, powered by the lightweight **Tauri v2** native engine. It focuses on local data management, external-plugin playback parsing, and UI customization. It contains no ads and does not collect or upload your personal data.

The modern refactor features an isolated **Web Worker LX sound source sandbox** paired with a zero-cost **Tauri IPC ContextBridge adapter**, drastically reducing memory and CPU overhead while offering lightning-fast cold boot times.

<img width="1022" height="692" alt="image" src="https://img.meituan.net/content/1a7c6bc9cfc1c3f7dfa9a95d2a194cf0337799.png" />

## Download

Download the latest release from [GitHub Releases](https://github.com/raclen/AnhePlayer/releases).

Currently supports **Windows (10 / 11)**:

- **Windows Installers** (`.msi` / `.exe`)
- **Windows Portable Edition** (Unzip and run)

## Features

| Feature                       | Description                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Windows Desktop App           | Deeply optimized for Windows with sub-second cold boot and minimal memory footprint |
| Plugin-based playback parsing | Supports LX `.js` plugins for playback URL parsing                                  |
| Source redirect               | Routes playback requests to available parser sources                                |
| Multi-quality playback        | Supports low, standard, high, and super quality options when provided by plugins    |
| Theme packs                   | Customizes colors, backgrounds, and the overall app appearance                      |
| Local data                    | App data stays on your device and personal data is not uploaded                     |

## Plugins

Anhe Player does not ship with built-in playback parser plugins. You can install LX `.js` plugin files or add http(s) plugin links ending in `.js` from the plugin manager.

Sources declared by installed plugins are adapted into playback parser sources and can be used for playback parsing, multi-quality switching, and source redirect.

Plugin capability summary:

```text
Playback parsing    LX musicUrl parsing, multi-quality switching, source redirect
Install             Local .js file, remote .js link
```

## Theme Packs

Anhe Player supports theme packs for UI customization. The app includes light and pure black themes, and the theme marketplace also ships a set of curated themes you can install directly.

A theme pack can be a folder or a `.mftheme` archive:

```text
my-theme/
├── config.json
├── index.css
├── preview.png
└── iframes/
    └── app.html
```

Example `config.json`:

```jsonc
{
    "name": "Theme name",
    "preview": "#000000",
    "description": "Theme description",
    "author": "Author",
    "authorUrl": "https://example.com",
    "version": "1.0.0",
    "srcUrl": "https://example.com/theme.mftheme",
    "thumb": "@/thumb.png",
    "blurHash": "LEHV6nWB2yk8pyo...",
    "iframe": {
        "app": "@/iframes/app.html",
    },
}
```

Use `@/` to reference the theme pack root directory. For the full list of supported theme variables, see the built-in light theme:

[`res/builtin-themes/light/index.css`](./res/builtin-themes/light/index.css)

Curated themes currently available in the marketplace:

- `柔雾白昼`: Figma-inspired light theme
- `极夜流光`: Figma-inspired dark theme
- `Silk Motion`: more Apple Music-like
- `Pulse Grid`: more Linear / Raycast-like
- `Hype Wave`: more trend-driven music product styling

## Development

### Requirements

| Dependency | Version | Note                                                 |
| ---------- | ------- | ---------------------------------------------------- |
| Node.js    | 22      | Frontend & build runtime                             |
| pnpm       | 9+      | Package manager                                      |
| Rust       | 1.80+   | Tauri v2 core compilation (Optional, only for Tauri) |

> For comprehensive architecture design and migration details, please refer to the [Tauri Migration & Architecture Guide](./TAURI_MIGRATION_GUIDE.md).

### Quick Start

```bash
git clone https://github.com/raclen/AnhePlayer.git
cd AnhePlayer
pnpm install

# Start the Tauri v2 development environment
pnpm tauri:dev

```

### Commands

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `pnpm tauri:dev`   | **Start Tauri v2 dev mode** (Vite + Rust core)   |
| `pnpm tauri:build` | **Build Tauri v2 lightweight package** (MSI/EXE) |
| `pnpm run lint`    | Run lint checks                                  |
| `pnpm run format`  | Format code                                      |

## Release

GitHub Actions builds Windows desktop installers:

- [`Tauri Build & Release`](./.github/workflows/tauri-build.yml): builds Windows (x86_64) installers and uploads to Releases

## Contributing

Issues and pull requests are welcome. Please read the [Contributing Guide](./CONTRIBUTING.md) before starting development.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=raclen/AnhePlayer&type=Date)](https://star-history.com/#raclen/AnhePlayer&Date)

## License

This project is open-sourced under the [AGPL-3.0-only](./LICENSE) license. Please comply with the license when using, modifying, distributing, or republishing this project.
