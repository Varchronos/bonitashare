import { TIER_LIMITS, quotaMessages, type ApiResponse, type Usage } from '@bonitashare/shared-types';
import { create } from 'zustand/react';
import { useUploadStore, type UploadTask } from './file-store';

interface UsageStore {
    usage: Usage | null;
    // Uploads still in progress that the server had already created when `usage` was fetched. The
    // server reserves an upload's full size at create, so these are already in `usage` at full size.
    countedIds: string[];
    setUsage: (usage: Usage, countedIds?: string[]) => void;
}

// Not persisted: the server is the source of truth, and the page fetches it on every load.
export const useUsageStore = create<UsageStore>()((set) => ({
    usage: null,
    countedIds: [],
    setUsage: (usage, countedIds = []) => set({ usage, countedIds }),
}));

function isActive(task: UploadTask) {
    return task.status === 'queued' || task.status === 'uploading' || task.status === 'paused';
}

export type Meter = {
    // What the server counts, minus the in-progress uploads it counted at full size.
    committed: number;
    // Bytes the in-progress uploads have sent so far — what the meter shows on top of `committed`.
    inProgress: number;
    // Full size of the in-progress uploads — what the server charges for them, and what a new file has to fit beside.
    reserved: number;
    limit: number | null;
};

export function liveUsage(usage: Usage, files: UploadTask[], countedIds: string[]) {
    let counted = 0;
    let inProgress = 0;
    let reserved = 0;
    for (const task of files) {
        if (!isActive(task)) continue;
        inProgress += task.bytesUploaded;
        reserved += task.sizeBytes;
        if (countedIds.includes(task.id)) counted += task.sizeBytes;
    }

    const meter = (used: number, limit: number | null): Meter => ({
        committed: Math.max(0, used - counted),
        inProgress,
        reserved,
        limit,
    });
    return { weekly: meter(usage.weekly.used, usage.weekly.limit), storage: meter(usage.storage.used, usage.storage.limit) };
}

// Why a file won't be accepted, checked before it's queued so the user doesn't wait for the server
// to say so. Null when it fits, or when usage never loaded — the server checks either way.
export function quotaProblem(size: number): string | null {
    const { usage, countedIds } = useUsageStore.getState();
    if (!usage) return null;

    if (size > TIER_LIMITS[usage.tier].maxFileBytes) {
        return quotaMessages.fileTooLarge(usage.tier);
    }

    const { weekly, storage } = liveUsage(usage, useUploadStore.getState().files, countedIds);
    const weeklyLeft = usage.weekly.limit - weekly.committed - weekly.reserved;
    if (size > weeklyLeft) {
        return quotaMessages.weeklyFull(weeklyLeft, usage.weekly.limit);
    }
    const storageLimit = usage.storage.limit;
    if (storageLimit !== null) {
        const storageLeft = storageLimit - storage.committed - storage.reserved;
        if (size > storageLeft) return quotaMessages.storageFull(storageLeft, storageLimit);
    }
    return null;
}

// Coalesced: uploads ending together trigger one request, plus one more if any ended while it was out.
let refreshing: Promise<void> | null = null;
let refreshAgain = false;

export function refreshUsage() {
    if (refreshing) {
        refreshAgain = true;
        return;
    }
    refreshing = (async () => {
        // Taken before the request: these exist on the server already, so the response counts them.
        const countedIds = useUploadStore
            .getState()
            .files.filter((task) => isActive(task) && task.tusUploadUrl)
            .map((task) => task.id);
        try {
            const res = await fetch('/api/v1/usage');
            const { data } = (await res.json()) as ApiResponse<Usage>;
            if (data) useUsageStore.getState().setUsage(data, countedIds);
        } catch {
            // Keep showing the last numbers; the next upload that ends tries again.
        }
    })().finally(() => {
        refreshing = null;
        if (refreshAgain) {
            refreshAgain = false;
            refreshUsage();
        }
    });
}
