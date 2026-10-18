/**
 * 洛雪插件 Worker 宿主（主线程侧）
 *
 * 职责：
 * - 创建工作线程并维护消息协议
 * - 转发 Worker 的 HTTP 请求：优先 Tauri http_request（穿透 CORS），失败回退 fetch
 * - 初始化插件代码，暴露按 platform 的方法调用
 */
// @ts-nocheck —— Vite 专属模块（Worker + import.meta.url），commonjs 模式的 tsconfig 无法正确检查；类型安全由 Vite 构建与 ESLint 保障
import { tauriInvoke } from '@infra/tauriBridge/ipc';

interface IHostRequestPayload {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
    responseType?: string;
}

interface IWorkerMessage {
    type: string;
    id?: string;
    reqId?: string;
    delegates?: any[];
    result?: any;
    error?: string;
    payload?: IHostRequestPayload;
}

export class LxPluginHost {
    private worker: Worker;
    private waiters = new Map<
        string,
        { resolve: (value: IWorkerMessage) => void; reject: (error: Error) => void }
    >();
    private seq = 0;

    public delegates: IPlugin.IPluginDelegate[] = [];

    constructor() {
        this.worker = new Worker(new URL('./lxWorker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', (event: MessageEvent) => this.onMessage(event));
        this.worker.addEventListener('error', (event: ErrorEvent) => {
            console.error('[LxPluginHost] Worker error:', event.message);
        });
    }

    private onMessage(event: MessageEvent): void {
        const data = (event.data || {}) as IWorkerMessage;

        if (data.type === 'host_request' && data.reqId) {
            void this.forwardHttp(data.payload as IHostRequestPayload, data.reqId);
            return;
        }

        if (!data.id) return;
        const waiter = this.waiters.get(data.id);
        if (!waiter) return;
        this.waiters.delete(data.id);
        if (data.type === 'init_error' || data.type === 'call_error') {
            waiter.reject(new Error(data.error || 'Worker operation failed'));
        } else {
            waiter.resolve(data);
        }
    }

    /** 转发 HTTP 请求：优先 Tauri http_request，失败回退原生 fetch */
    private async forwardHttp(payload: IHostRequestPayload, reqId: string): Promise<void> {
        try {
            const res = await tauriInvoke<{
                statusCode: number;
                headers: Record<string, string>;
                body: string;
            }>('http_request', {
                url: payload.url,
                options: {
                    method: payload.method,
                    headers: payload.headers,
                    body: payload.body,
                },
            });
            const bodyText = typeof res?.body === 'string' ? res.body : '';
            this.worker.postMessage({
                type: 'host_response',
                reqId,
                result: {
                    status: res?.statusCode ?? 0,
                    headers: res?.headers ?? {},
                    data: this.parseBody(bodyText, payload.responseType),
                },
                error: null,
            });
        } catch {
            try {
                const resp = await fetch(payload.url, {
                    method: payload.method,
                    headers: payload.headers,
                    body:
                        payload.body === undefined || payload.body === null
                            ? undefined
                            : typeof payload.body === 'string'
                              ? payload.body
                              : JSON.stringify(payload.body),
                });
                const text = await resp.text();
                this.worker.postMessage({
                    type: 'host_response',
                    reqId,
                    result: {
                        status: resp.status,
                        headers: Object.fromEntries(resp.headers.entries()),
                        data: this.parseBody(text, payload.responseType),
                    },
                    error: null,
                });
            } catch (err2: any) {
                this.worker.postMessage({
                    type: 'host_response',
                    reqId,
                    result: null,
                    error: String(err2?.message || err2),
                });
            }
        }
    }

    private parseBody(text: string, responseType?: string): any {
        if (responseType === 'text') return text;
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    /** 在 Worker 中初始化插件代码，返回各音源 delegate（hash 由调用方补齐） */
    public async initialize(code: string, timeoutMs = 20000): Promise<IPlugin.IPluginDelegate[]> {
        const id = `init_${++this.seq}`;
        const response = await this.request(id, timeoutMs, () => {
            this.worker.postMessage({ type: 'init_plugin', id, code });
        });
        this.delegates = (response.delegates ?? []) as IPlugin.IPluginDelegate[];
        return this.delegates;
    }

    /** 调用插件音源的指定方法（args 已由调用方按 normalizer 清洗） */
    public async callMethod(platform: string, method: string, args: any[]): Promise<any> {
        const id = `call_${++this.seq}`;
        const response = await this.request(id, 120000, () => {
            this.worker.postMessage({ type: 'call_method', id, platform, method, args });
        });
        return response.result;
    }

    private request(id: string, timeoutMs: number, send: () => void): Promise<IWorkerMessage> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(id);
                reject(new Error('Plugin worker timeout'));
            }, timeoutMs);
            this.waiters.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            send();
        });
    }

    public terminate(): void {
        this.waiters.clear();
        this.worker.terminate();
    }
}
