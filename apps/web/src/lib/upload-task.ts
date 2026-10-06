import * as tus from 'tus-js-client'
import type { ApiResponse } from '@bonitashare/shared-types'
import { useUploadStore } from '../store/file-store'

export class UploadQueue {
    public queue: tus.Upload[]
    public maxParallel: number
    public activeUploads: tus.Upload[]

    constructor(maxParallel = 3) {
        this.queue = []
        this.maxParallel = maxParallel
        this.activeUploads = []
    }


    _processNext() {
        if (this.activeUploads.length >= this.maxParallel || this.queue.length === 0) return;

        const upload = this.queue.shift()
        if (!upload) {
            console.error('error moving upload to active queue')
            return;
        }
        this.activeUploads.push(upload)

        const onSuccess = upload.options.onSuccess;
        const onError = upload.options.onError

        upload.options.onSuccess = (p) => {
            this._handleFinished(upload)
            onSuccess?.(p)
        }

        upload.options.onError = (e) => {
            this._handleFinished(upload)
            onError?.(e)
        }


        upload.start()

        this._processNext()
    }

    _handleFinished(upload: tus.Upload) {
        this.activeUploads = this.activeUploads.filter(item => item !== upload)
        this._processNext();
    }

    add(instance: tus.Upload) {
        this.queue.push(instance)
        this._processNext()
    }


    abort(upload: tus.Upload) {
        if (this.activeUploads.includes(upload)) {
            upload.abort()
            this._handleFinished(upload)
        } else {
            this.queue = this.queue.filter(job => job !== upload)
        }
    }


}

// Module-level, not component state: these hold live network objects the
// queue needs across re-renders and across whichever component happens to
// be mounted — there's only ever one upload engine for the page.
const queue = new UploadQueue(3)
const liveUploads = new Map<string, tus.Upload>()

// Shared across all active uploads so a burst of 401s triggers one renewal.
let sessionRenewal: Promise<unknown> | null = null

function renewSession() {
    sessionRenewal ??= fetch('/api/session').finally(() => { sessionRenewal = null })
    return sessionRenewal
}

function shouldRetryUpload(err: tus.DetailedError) {
    // tus-js-client's default policy treats every 4xx (except 409/423) as
    // non-retryable — that excludes 429, which is exactly the error our own
    // rate limiter returns, so it'd otherwise go straight to onError instead
    // of backing off and retrying.
    const status = err.originalResponse?.getStatus() ?? 0
    const online = typeof navigator === 'undefined' || navigator.onLine
    if (!online) return false

    // Session expired: GET /session reissues it for the same user, then the
    // retry (gated in onBeforeRequest) goes out with the new cookie.
    if (status === 401) {
        renewSession()
        return true
    }
    return status < 400 || status >= 500 || status === 409 || status === 423 || status === 429
}

export function enqueueFile(file: File): string {
    const id = crypto.randomUUID()
    const { addFiles, updateFile } = useUploadStore.getState()

    const upload = new tus.Upload(file, {
        endpoint: '/api/upload',
        metadata: { filename: file.name, filetype: file.type },
        chunkSize: 5 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        onShouldRetry: shouldRetryUpload,
        onBeforeRequest: async () => { await sessionRenewal },
        // Reused as the share-link id once the upload completes — see
        // linkFor() in TaskRow.
        onUploadUrlAvailable: () => updateFile(id, { tusUploadUrl: upload.url ?? '' }),
        onProgress: (bytesUploaded) => updateFile(id, { status: 'uploading', bytesUploaded }),
        onSuccess: () => updateFile(id, { status: 'done', bytesUploaded: file.size }),
        onError: (err) => updateFile(id, { status: 'error', errorMessage: err.message }),
    })

    liveUploads.set(id, upload)
    addFiles([
        {
            id,
            ownerId: null,
            storageKey: '',
            thumbKey: null,
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            isPublic: true,
            createdAt: new Date(),
            expiresAt: null,
            tusUploadUrl: '',
            bytesUploaded: 0,
            status: 'queued',
            errorMessage: null,
        },
    ])
    queue.add(upload)

    return id
}

export function pauseUpload(id: string) {
    const upload = liveUploads.get(id)
    if (!upload) return
    queue.abort(upload)
    useUploadStore.getState().updateFile(id, { status: 'paused' })
}

// Also used to retry a failed upload — resuming and retrying are the same
// operation here: push the same tus.Upload instance back into the queue and
// let it re-check its offset (or recreate the resource, if it never got
// that far) on its next turn.
export function resumeUpload(id: string) {
    const upload = liveUploads.get(id)
    if (!upload) return
    useUploadStore.getState().updateFile(id, { status: 'queued', errorMessage: null })
    queue.add(upload)
}

// The share link id only exists once tus has created the upload — derive it
// from the resource URL rather than tracking it separately.
export function shareIdFor(task: { tusUploadUrl: string }) {
    return task.tusUploadUrl.split('/').filter(Boolean).pop() ?? null
}

// The worker makes thumbnails shortly after an upload finishes, so check a few
// times with backoff, then give up quietly — the row keeps its file icon, and
// the next page load tries again.
const THUMBNAIL_POLL_DELAYS_MS = [1000, 2000, 4000, 8000]
// A video's poster comes from the video-worker after it has downloaded and
// probed the file, and behind any transcode already running, so it gets
// about two minutes rather than fifteen seconds.
const VIDEO_THUMBNAIL_POLL_DELAYS_MS = [2000, 4000, 8000, 15000, 30000, 60000]

export async function watchThumbnail(id: string, signal: AbortSignal) {
    const task = useUploadStore.getState().files.find((f) => f.id === id)
    const shareId = task && shareIdFor(task)
    if (!shareId) return

    const delays = task.contentType.startsWith('video/') ? VIDEO_THUMBNAIL_POLL_DELAYS_MS : THUMBNAIL_POLL_DELAYS_MS
    for (const delay of delays) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (signal.aborted) return
        try {
            const res = await fetch(`/api/thumbnail/${shareId}`, { signal })
            // 404/410: the file is gone or not visible to us; polling won't change that.
            if (!res.ok) return
            const { data } = (await res.json()) as ApiResponse<{ thumbnailUrl: string | null }>
            if (data?.thumbnailUrl) {
                useUploadStore.getState().updateFile(id, { thumbnailUrl: data.thumbnailUrl })
                return
            }
        } catch {
            if (signal.aborted) return
        }
    }
}

export function cancelUpload(id: string) {
    const upload = liveUploads.get(id)
    if (upload) {
        queue.abort(upload)
        upload.abort(true).catch(() => {})
        liveUploads.delete(id)
    }
    useUploadStore.getState().removeFile(id)
}
