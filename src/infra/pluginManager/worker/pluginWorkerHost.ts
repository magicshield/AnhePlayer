/**
 * 宿主主线程插件实例管理器
 */
import { WORKER_SANDBOX_SOURCE } from './webWorkerSandbox';
import { tauriInvoke } from '@infra/tauriBridge/ipc';

export interface IWorkerPluginInstance {
    hash: string;
    name: string;
    version: string;
    author: string;
    description: string;
    supportedSources: string[];
    invokeAction(params: any): Promise<any>;
    terminate(): void;
}

export class PluginWorkerHost {
    private worker: Worker;
    private messageWaiters = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

    public hash: string;
    public name = '未知音源';
    public version = '1.0.0';
    public author = '';
    public description = '';
    public supportedSources: string[] = [];

    constructor(hash: string, code: string) {
        this.hash = hash;
        this.parseMetadata(code);

        const blob = new Blob([WORKER_SANDBOX_SOURCE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        this.worker = new Worker(blobUrl);

        this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
    }

    private parseMetadata(code: string): void {
        const nameMatch = code.match(/@name\s+([^\r\n]+)/);
        const versionMatch = code.match(/@version\s+([^\r\n]+)/);
        const authorMatch = code.match(/@author\s+([^\r\n]+)/);
        const descMatch = code.match(/@description\s+([^\r\n]+)/);

        if (nameMatch) this.name = nameMatch[1].trim();
        if (versionMatch) this.version = versionMatch[1].trim();
        if (authorMatch) this.author = authorMatch[1].trim();
        if (descMatch) this.description = descMatch[1].trim();
    }

    private async handleWorkerMessage(e: MessageEvent): Promise<void> {
        const data = e.data;
        if (!data) return;

        // 处理 Worker 内部发起的网络请求 (穿透 CORS)
        if (data.type === 'lx_request') {
            const { reqId, payload } = data;
            const { url, options } = payload;
            try {
                // 优先通过 Tauri 后端请求绕过 CORS，降级使用原生 fetch
                let resData: { statusCode: number; headers: Record<string, string>; body: string };
                try {
                    resData = await tauriInvoke('http_request', { url, options });
                } catch {
                    const fetchRes = await fetch(url, {
                        method: options?.method || 'GET',
                        headers: options?.headers,
                        body: options?.body,
                    });
                    const text = await fetchRes.text();
                    resData = {
                        statusCode: fetchRes.status,
                        headers: Object.fromEntries(fetchRes.headers.entries()),
                        body: text,
                    };
                }

                this.worker.postMessage({
                    type: 'lx_response',
                    reqId,
                    error: null,
                    response: { statusCode: resData.statusCode, headers: resData.headers },
                    body: resData.body,
                });
            } catch (err: any) {
                this.worker.postMessage({
                    type: 'lx_response',
                    reqId,
                    error: err.message || 'Network request failed',
                    response: null,
                    body: null,
                });
            }
            return;
        }

        // 插件初始化上报
        if (data.type === 'inited') {
            if (data.sources) {
                this.supportedSources = Object.keys(data.sources);
            }
            return;
        }

        // 回调处理
        if (data.id && this.messageWaiters.has(data.id)) {
            const { resolve, reject } = this.messageWaiters.get(data.id)!;
            this.messageWaiters.delete(data.id);
            if (data.type.endsWith('_success')) {
                resolve(data.result);
            } else {
                reject(new Error(data.error || 'Worker operation failed'));
            }
        }
    }

    public async initialize(code: string): Promise<void> {
        const id = Math.random().toString(36).slice(2);
        return new Promise((resolve, reject) => {
            this.messageWaiters.set(id, { resolve, reject });
            this.worker.postMessage({ type: 'init_plugin', id, code });
        });
    }

    public async invokeAction(params: any): Promise<any> {
        const id = Math.random().toString(36).slice(2);
        return new Promise((resolve, reject) => {
            this.messageWaiters.set(id, { resolve, reject });
            this.worker.postMessage({ type: 'invoke_action', id, params });
        });
    }

    public terminate(): void {
        this.worker.terminate();
        this.messageWaiters.clear();
    }
}
