import '@infra/tauriBridge/autoInject';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import bootstrapMainWindow from '../bootstrap/mainWindow';
import router from './router';
import { initTauriBridges } from '@infra/tauriBridge';

document.body.dataset.window = 'main';

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element not found');
}

const root = createRoot(container);

function renderErrorFallback(error: any) {
    const errorMsg = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error);
    root.render(
        <div style={{
            padding: 32,
            fontFamily: 'Segoe UI, sans-serif',
            background: '#18181b',
            color: '#f4f4f5',
            height: '100vh',
            boxSizing: 'border-box',
            overflow: 'auto',
        }}>
            <h2 style={{ color: '#ef4444', marginTop: 0 }}>⚠️ 播放器初始化异常 (Renderer Error)</h2>
            <p style={{ color: '#a1a1aa' }}>如果在启动过程中发生错误，请将以下堆栈信息反馈：</p>
            <pre style={{
                background: '#09090b',
                padding: 16,
                borderRadius: 8,
                border: '1px solid #27272a',
                color: '#f87171',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: 13,
            }}>
                {errorMsg}
            </pre>
            <button
                style={{
                    marginTop: 16,
                    padding: '8px 16px',
                    borderRadius: 6,
                    background: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                }}
                onClick={() => window.location.reload()}
            >
                重新加载应用
            </button>
        </div>
    );
}

window.addEventListener('error', (event) => {
    console.error('[MainWindow Error]', event.error || event.message);
    if (!document.querySelector('#root > *')) {
        renderErrorFallback(event.error || event.message);
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('[MainWindow UnhandledRejection]', event.reason);
    if (!document.querySelector('#root > *')) {
        renderErrorFallback(event.reason);
    }
});

initTauriBridges()
    .then(() => bootstrapMainWindow())
    .then(() => {
        root.render(
            <React.StrictMode>
                <RouterProvider router={router} />
            </React.StrictMode>,
        );
    })
    .catch((err) => {
        console.error('[MainWindow Bootstrap Failed]', err);
        renderErrorFallback(err);
    });
