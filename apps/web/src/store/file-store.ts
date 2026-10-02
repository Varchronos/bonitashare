import type { FileItem } from "@bonitashare/shared-types";
import { get, set, del, clear } from 'idb-keyval'
import { persist, type StorageValue } from "zustand/middleware";
import { create } from "zustand/react";


export type UploadTaskStatus = 'queued' | 'uploading' | 'paused' | 'cancelled' | 'done' | 'error'
export type UploadTask = Omit<FileItem, 'fileStatus'> & {
    tusUploadUrl: string;
    // Filled in after the upload, once the worker has made one. Optional because tasks persisted
    // before this field existed won't have it.
    thumbnailUrl?: string | null;
    bytesUploaded: number;
    status: UploadTaskStatus,
    errorMessage: string | null
}


interface FileUploadStore {
    files: UploadTask[];
    addFiles: (file: UploadTask[]) => void
    updateFile: (id: string, patch: Partial<UploadTask>) => void
    removeFile: (idx: string) => void
    clear: () => void
}


const indexedDBAdapter = {
    getItem: async (id: string) => {
        if (!window) return null; // ssr check
        return (await get(id)) || null
    },

    setItem: async (id: string, file: StorageValue<FileUploadStore>) => {
        if (!window) return;
        await set(id, file)
    },

    removeItem: async (id: string) => {
        if (!window) return
        await del(id)
    },

    clear: async () => {
        if (!window) return
        try {
            await clear()
            console.log('cleared indexedDB successfully')
        } catch (e) {
            console.error('failed to nuke indexedDB', e)
        }
    }
}



export const useUploadStore = create<FileUploadStore>()(
    persist(
        (set, get) => ({
            files: [] as UploadTask[],
            addFiles: (newFiles) => set({ files: [...get().files, ...newFiles] }),
            updateFile: (id, patch) => set({ files: get().files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }),
            removeFile: (id: string) => set({ files: [...get().files.filter((f) => f.id !== id)] }),
            clear: async () => {
                await indexedDBAdapter.clear()

                set({ files: [] })
            }
        }), {
        name: 'file-upload-store',
        storage: indexedDBAdapter,
        skipHydration: true,
        // Without this, persist serializes the whole store on every write —
        // including addFiles/updateFile/removeFile/clear — and IndexedDB's
        // structured clone throws on functions ("Function object could not
        // be cloned"). Only the data needs to survive a reload.
        // Cast needed because persist's default typing expects partialize to
        // return the full store shape; the actual rehydrate merge only ever
        // needs `files` — the actions always come from the live store.
        partialize: (state) => ({ files: state.files }) as FileUploadStore,
    }
    )
)