/**
 * data 层：JSON 文件存储（惰性加载 + 防抖落盘）
 *
 * - 首次 load 前等待 globalContext 就绪（Rust 回填真实 userData 路径），
 *   避免把数据读写到默认硬编码路径
 * - 文件损坏时回退默认值（不覆盖原文件，下一次落盘重建）
 */
import { whenGlobalContextReady } from '../globalContext';
import { dirnameOf } from './pathUtils';
import { ensureDir, readTextFile, writeTextFile } from './tauriFs';

export class JsonFileStore<T extends object> {
    private data: T | null = null;
    private loadPromise: Promise<T> | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private dirty = false;

    constructor(
        private readonly resolvePath: () => string,
        private readonly createDefault: () => T,
    ) {}

    async load(): Promise<T> {
        if (this.data) return this.data;
        if (!this.loadPromise) {
            this.loadPromise = this.doLoad();
        }
        return this.loadPromise;
    }

    private async doLoad(): Promise<T> {
        await whenGlobalContextReady();
        const path = this.resolvePath();
        if (!path) {
            this.data = this.createDefault();
            return this.data;
        }
        const raw = await readTextFile(path);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    this.data = { ...this.createDefault(), ...parsed };
                    return this.data;
                }
            } catch {
                /* 损坏文件 → 使用默认值 */
            }
        }
        this.data = this.createDefault();
        return this.data;
    }

    /** 读取（必须先 load；未加载时抛错，防止静默丢数据） */
    get(): T {
        if (!this.data) throw new Error('JsonFileStore accessed before load()');
        return this.data;
    }

    isLoaded(): boolean {
        return this.data !== null;
    }

    /** 防抖落盘（默认 400ms） */
    scheduleSave(delay = 400): void {
        this.dirty = true;
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, delay);
    }

    async flush(): Promise<void> {
        if (!this.data || !this.dirty) return;
        const path = this.resolvePath();
        if (!path) return;
        this.dirty = false;
        try {
            await ensureDir(dirnameOf(path));
            const ok = await writeTextFile(path, JSON.stringify(this.data));
            if (!ok) this.dirty = true;
        } catch {
            this.dirty = true;
        }
    }
}
