/**
 * 软件更新角标状态。
 *
 * 启动检查在 bootstrap 中完成，UI 组件通过 Jotai 订阅，避免用弹窗打断用户。
 */
import { atom, getDefaultStore } from 'jotai';
import type { IUpdateInfo } from '@appTypes/infra/systemUtil';

export type PendingUpdate = NonNullable<IUpdateInfo['update']>;

export const pendingUpdateAtom = atom(null as PendingUpdate | null);

const store = getDefaultStore();

export function setPendingUpdate(update: PendingUpdate): void {
    store.set(pendingUpdateAtom, update);
}

export function clearPendingUpdate(): void {
    store.set(pendingUpdateAtom, null);
}
