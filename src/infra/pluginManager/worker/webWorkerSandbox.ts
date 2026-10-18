/**
 * Web Worker 洛雪插件沙箱引擎
 *
 * 参考 anhe-downloader 设计，将第三方混淆 JS 音源插件的执行环境移至前端 Web Worker。
 * 核心特性：
 * 1. 彻底解绑 Node.js vm 与 C++ 原生依赖，在纯 Web / WebView 环境中高效运行；
 * 2. 模拟完整的 globalThis.lx 沙箱 API（EVENT_NAMES, on, send, request）；
 * 3. 网络请求通过 Worker 通信由 Tauri 宿主转发，完美穿透 CORS 与防盗链限制。
 */

export interface WorkerLxRequestPayload {
    url: string;
    options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: any;
    };
}

export interface WorkerLxResponsePayload {
    error: string | null;
    response: {
        statusCode: number;
        headers: Record<string, string>;
    } | null;
    body: string | null;
}

/** 注入到 Worker 内部运行的洛雪沙箱初始化源码 */
export const WORKER_SANDBOX_SOURCE = `
(function() {
    const handlers = new Map();
    let sourcesMeta = {};

    function log(...args) {
        self.postMessage({ type: 'log', args });
    }

    const sandboxLx = {
        EVENT_NAMES: {
            inited: 'inited',
            request: 'request',
            updateAlert: 'updateAlert'
        },
        request: function(url, options, callback) {
            const reqId = Math.random().toString(36).slice(2);
            function onResponse(e) {
                if (e.data && e.data.type === 'lx_response' && e.data.reqId === reqId) {
                    self.removeEventListener('message', onResponse);
                    const { error, response, body } = e.data;
                    callback(error ? new Error(error) : null, response, body);
                }
            }
            self.addEventListener('message', onResponse);
            self.postMessage({
                type: 'lx_request',
                reqId,
                payload: { url, options }
            });
        },
        on: function(event, handler) {
            if (event === 'request') {
                handlers.set('request', handler);
            }
        },
        send: function(event, data) {
            if (event === 'inited') {
                if (data && data.sources) {
                    sourcesMeta = data.sources;
                }
                self.postMessage({
                    type: 'inited',
                    sources: sourcesMeta
                });
            }
        }
    };

    self.addEventListener('message', async function(e) {
        const { type, id, code, params } = e.data;

        if (type === 'init_plugin') {
            try {
                const runner = new Function('globalThis', \`
                    globalThis.lx = arguments[1];
                    \${code}
                \`);
                runner(self, sandboxLx);
                self.postMessage({ type: 'init_success', id });
            } catch (err) {
                self.postMessage({ type: 'init_error', id, error: err.message });
            }
            return;
        }

        if (type === 'invoke_action') {
            const reqHandler = handlers.get('request');
            if (!reqHandler) {
                self.postMessage({ type: 'invoke_error', id, error: 'Plugin request handler not found' });
                return;
            }
            try {
                const result = await reqHandler(params);
                self.postMessage({ type: 'invoke_success', id, result });
            } catch (err) {
                self.postMessage({ type: 'invoke_error', id, error: err.message });
            }
        }
    });
})();
`;
