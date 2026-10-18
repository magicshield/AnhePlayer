/**
 * 洛雪插件沙箱 Worker 入口
 *
 * 消息协议（宿主 → Worker）：
 *  - init_plugin   { id, code }                   初始化插件文件，返回全部音源 delegate
 *  - call_method   { id, platform, method, args } 调用指定音源的方法
 *  - host_response { reqId, result, error }       HTTP 桥回复
 * 消息协议（Worker → 宿主）：
 *  - init_success / init_error、call_success / call_error、host_request
 */
import { executeLxPluginCode, extractPluginDelegate, handleHostResponse } from './lxSandboxCore';

interface IWorkerScope {
    postMessage: (message: any) => void;
    addEventListener: (type: string, listener: (event: any) => void) => void;
}

const scope = self as unknown as IWorkerScope;

let instances: IPlugin.IPluginInstance[] | null = null;

scope.addEventListener('message', (event: any) => {
    const data = event?.data;
    if (!data) return;

    if (data.type === 'init_plugin') {
        void (async () => {
            try {
                const result = await executeLxPluginCode(data.code, '', '');
                if (!result || result.length === 0) {
                    throw new Error('Failed to parse plugin: no available sources');
                }
                instances = result;
                const delegates = result.map((instance) => extractPluginDelegate(instance, ''));
                scope.postMessage({ type: 'init_success', id: data.id, delegates });
            } catch (err: any) {
                scope.postMessage({
                    type: 'init_error',
                    id: data.id,
                    error: String(err?.message || err),
                });
            }
        })();
        return;
    }

    if (data.type === 'call_method') {
        void (async () => {
            try {
                if (!instances) throw new Error('Plugin not initialized');
                const instance = instances.find((item) => item.platform === data.platform);
                if (!instance) throw new Error(`Plugin source not found: ${data.platform}`);
                const methodFn = (instance as any)[data.method];
                if (typeof methodFn !== 'function') {
                    throw new Error(`Method not implemented: ${data.method}`);
                }
                const result = await methodFn.apply(instance, data.args ?? []);
                scope.postMessage({ type: 'call_success', id: data.id, result });
            } catch (err: any) {
                scope.postMessage({
                    type: 'call_error',
                    id: data.id,
                    error: String(err?.message || err),
                });
            }
        })();
        return;
    }

    if (data.type === 'host_response') {
        handleHostResponse(data.reqId, data.result, data.error);
    }
});
