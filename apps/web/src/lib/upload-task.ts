import * as tus from 'tus-js-client'
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

function shouldRetryUpload(err: tus.DetailedError) {
    // tus-js-client's default policy treats every 4xx (except 409/423) as
    // non-retryable — that excludes 429, which is exactly the error our own
    // rate limiter returns, so it'd otherwise go straight to onError instead
    // of backing off and retrying.
    const status = err.originalResponse?.getStatus() ?? 0
    const online = typeof navigator === 'undefined' || navigator.onLine
    return online && (status < 400 || status >= 500 || status === 409 || status === 423 || status === 429)
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

export function cancelUpload(id: string) {
    const upload = liveUploads.get(id)
    if (upload) {
        queue.abort(upload)
        upload.abort(true).catch(() => {})
        liveUploads.delete(id)
    }
    useUploadStore.getState().removeFile(id)
}
