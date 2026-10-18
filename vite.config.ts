import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    base: './',
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
});
