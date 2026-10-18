import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
    base: './',
    // 与 Electron 构建（config/webpack.plugins.ts 的 DefinePlugin）保持一致的编译期常量。
    // 缺少该定义时，源码中的 __DEV__ 在生产 WebView 中会抛出 ReferenceError 导致白屏。
    define: {
        __DEV__: JSON.stringify(mode !== 'production'),
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@assets': path.resolve(__dirname, 'src/assets'),
            '@common': path.resolve(__dirname, 'src/common'),
            '@infra': path.resolve(__dirname, 'src/infra'),
            '@appTypes': path.resolve(__dirname, 'src/types'),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'mainWindow.html'),
                lyric: path.resolve(__dirname, 'lyricWindow.html'),
                minimode: path.resolve(__dirname, 'minimodeWindow.html'),
            },
        },
    },
}));
