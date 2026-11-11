import * as tus from 'tus-js-client'
import type { ApiResponse, IncompleteUpload } from '@bonitashare/shared-types'
import { useUploadStore, type UploadTask } from '../store/file-store'
import { markCounted, quotaProblem, refreshUsage } from '../store/usage-store'

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
    sessionRenewal ??= fetch('/api/v1/session').finally(() => { sessionRenewal = null })
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

const UPLOAD_ENDPOINT = '/api/v1/upload'

// An interrupted task this file can continue: one with no live upload behind it (restored after a
// reload, or listed by the server), for the same file. The last-modified time tells apart two files
// with the same name and size; uploads that never sent it are matched on name and size alone.
function findInterruptedTask(file: File) {
    return useUploadStore.getState().files.find((t) =>
        t.status === 'error' &&
        t.tusUploadUrl &&
        !liveUploads.has(t.id) &&
        t.filename === file.name &&
        t.sizeBytes === file.size &&
        (t.lastModified == null || t.lastModified === file.lastModified))
}

// Adding a file whose upload was interrupted continues that upload under its old task. Otherwise
// it's a new task, and if the quota check fails it's shown as failed with the reason and not started.
// Try again still sends it, so the server makes the final call.
export function enqueueFile(file: File): string {
    const interrupted = findInterruptedTask(file)
    const id = interrupted?.id ?? crypto.randomUUID()
    const { addFiles, updateFile } = useUploadStore.getState()

    const upload = new tus.Upload(file, {
        endpoint: UPLOAD_ENDPOINT,
        // Interrupted uploads are found through the task list instead, which the server fills in too.
        storeFingerprintForResuming: false,
        metadata: { filename: file.name, filetype: file.type, lastModified: String(file.lastModified) },
        // Cloudflare rejects request bodies over 100 MB, so this is the biggest chunk that fits, kept to
        // whole 8 MiB storage parts so a chunk never leaves a partial part for the next to re-read.
        // Most files go up in one request, which the server streams to storage part by part as it
        // arrives; bigger ones pay the per-request wait once every 88 MiB instead of every 8.
        chunkSize: 32 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        onShouldRetry: shouldRetryUpload,
        onBeforeRequest: async () => { await sessionRenewal },
        // Reused as the share-link id once the upload completes — see
        // linkFor() in TaskRow.
        onUploadUrlAvailable: () => updateFile(id, { tusUploadUrl: upload.url ?? '' }),
        onProgress: (bytesUploaded) => updateFile(id, { status: 'uploading', bytesUploaded }),
        onSuccess: () => {
            updateFile(id, { status: 'done', bytesUploaded: file.size })
            refreshUsage()
        },
        // The server's own explanation (file too large for the plan, weekly or storage limit reached, …)
        // when it sent one; tus's message is a dump of the request.
        onError: (err) => {
            const reason = 'originalResponse' in err ? err.originalResponse?.getBody()?.trim() : null
            updateFile(id, { status: 'error', errorMessage: reason || err.message })
            // A 403/413 means our numbers were stale. Any other failure may still hold a reservation.
            refreshUsage()
        },
    })

    liveUploads.set(id, upload)

    if (interrupted) {
        // tus asks the server how far it got and sends the rest. If the server no longer has it
        // (expired, cancelled, or another account's), tus starts a fresh upload instead.
        upload.url = interrupted.tusUploadUrl
        // The server reserved this upload's full size when it was created, so the usage from this
        // page load already includes it.
        markCounted(id)
        updateFile(id, { status: 'queued', errorMessage: null, lastModified: file.lastModified })
        queue.add(upload)
        return id
    }

    const blockedReason = quotaProblem(file.size)
    addFiles([
        {
            id,
            ownerId: null,
            storageKey: '',
            thumbKey: null,
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            lastModified: file.lastModified,
            isPublic: true,
            createdAt: new Date(),
            expiresAt: null,
            tusUploadUrl: '',
            bytesUploaded: 0,
            status: blockedReason ? 'error' : 'queued',
            errorMessage: blockedReason,
        },
    ])
    if (!blockedReason) queue.add(upload)

    return id
}

export const INTERRUPTED_MESSAGE = 'Upload interrupted. Add this file again to continue, or remove it.'

// Server-listed unfinished uploads this browser has no task for, added as interrupted tasks. Ones it
// already has (restored after a reload) get the server's offset, which is the true one.
export function addIncompleteUploads(incomplete: IncompleteUpload[]) {
    const { files, addFiles, updateFile } = useUploadStore.getState()
    const missing: UploadTask[] = []
    for (const upload of incomplete) {
        const task = files.find((t) => shareIdFor(t) === upload.id)
        if (task) {
            if (task.status === 'error' && !liveUploads.has(task.id)) updateFile(task.id, { bytesUploaded: upload.bytesUploaded })
            continue
        }
        missing.push({
            id: crypto.randomUUID(),
            ownerId: null,
            storageKey: '',
            thumbKey: null,
            filename: upload.filename,
            contentType: upload.contentType || 'application/octet-stream',
            sizeBytes: upload.sizeBytes,
            lastModified: upload.lastModified,
            isPublic: true,
            createdAt: new Date(upload.createdAt),
            expiresAt: null,
            tusUploadUrl: new URL(`${UPLOAD_ENDPOINT}/${upload.id}`, window.location.origin).href,
            bytesUploaded: upload.bytesUploaded,
            status: 'error',
            errorMessage: INTERRUPTED_MESSAGE,
        })
    }
    // Oldest first: the list shows the store's tail, newest first.
    if (missing.length) addFiles(missing.reverse())
}

// A Try again that can act: there's a live upload (with its file) to send again.
export function canRetry(id: string) {
    return liveUploads.has(id)
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

// For a task restored after a reload: the tab may have closed after the last byte landed but before
// the store saved 'done'. tus answers HEAD with how much it has; offset == length means finished.
// Any failure (gone, not ours, offline) counts as not finished — the task then stays as interrupted.
export async function isUploadFinished(task: UploadTask) {
    if (!task.tusUploadUrl) return false
    try {
        const res = await fetch(task.tusUploadUrl, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } })
        const offset = res.headers.get('Upload-Offset')
        return res.ok && offset !== null && offset === res.headers.get('Upload-Length')
    } catch {
        return false
    }
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
            const res = await fetch(`/api/v1/thumbnail/${shareId}`, { signal })
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
        // Terminating lowers the server's reservation to what was sent, so refetch once that's done.
        upload.abort(true).catch(() => {}).finally(refreshUsage)
        liveUploads.delete(id)
    } else {
        // An interrupted upload (no file behind it in this page): cancel it on the server by its URL,
        // which deletes the row and the partial data and lowers the reservation to what was sent.
        // If that fails, the server still lists it and it comes back on the next page load.
        const task = useUploadStore.getState().files.find((t) => t.id === id)
        if (task?.tusUploadUrl && task.status !== 'done') {
            tus.Upload.terminate(task.tusUploadUrl).catch(() => {}).finally(refreshUsage)
        }
    }
    useUploadStore.getState().removeFile(id)
}
