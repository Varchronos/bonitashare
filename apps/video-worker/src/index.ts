import 'dotenv/config';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createDb, fileVideos, files } from '@bonitashare/core/db';
import { BUCKET, HLS_BUCKET, THUMB_BUCKET, createStorage } from '@bonitashare/core/storage';
import {
    VIDEO_PROCESSING_QUEUE,
    createRedis,
    type TranscodeHlsJob,
    type VideoProcessingJobData,
    type VideoProcessingJobName,
} from '@bonitashare/core/queue';
import { onShutdown } from '@bonitashare/core/shutdown';

const execFileAsync = promisify(execFile);

const { db, pool } = createDb(process.env.DATABASE_URL!);
const storage = createStorage();
const redisConnection = createRedis(process.env.REDIS_URL!);

// Fail at startup rather than on the first job if the image was built without ffmpeg.
const { stdout } = await execFileAsync('ffmpeg', ['-version']);
console.log(stdout.split('\n')[0]);
await execFileAsync('ffprobe', ['-version']);

// ffmpeg and x264 count the host's cores, not the container's CPU limit, so under `cpus: 4` on a 16-core
// host they'd start threads for all 16 and spend the encode being throttled. cgroup v2's cpu.max holds
// the real quota ("400000 100000" for 4 CPUs, "max ..." when unlimited).
async function cpuLimit(): Promise<number> {
    try {
        const [quota, period] = (await readFile('/sys/fs/cgroup/cpu.max', 'utf8')).trim().split(' ');
        if (quota !== 'max') return Math.max(1, Math.floor(Number(quota) / Number(period)));
    } catch {
        // Not cgroup v2 (or not Linux): fall through to what the OS reports.
    }
    return availableParallelism();
}
const ENCODE_THREADS = await cpuLimit();
console.log(`encoding with ${ENCODE_THREADS} threads`);

const WORKDIR_PREFIX = 'transcode-';

// Past these the video just isn't streamable; the original stays downloadable either way.
// Size is checked before downloading so an oversized upload never touches the disk.
const MAX_SOURCE_BYTES = 2.5 * 1024 ** 3;
// One slot per instance, so this bounds how long a single upload can hold it.
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;

// Sized by the shorter side, so portrait video gets the same ladder as landscape. Never upscaled.
const RENDITIONS = [
    { shortSide: 1080, videoKbps: 5000 },
    { shortSide: 720, videoKbps: 2800 },
    { shortSide: 480, videoKbps: 1400 },
    { shortSide: 360, videoKbps: 800 },
];
const AUDIO_KBPS = 128;
// Keyframes land on every segment boundary, so players can switch renditions between any two segments.
const SEGMENT_SECONDS = 6;
// High-frame-rate phone clips (slow-mo is 120-240fps) would multiply encode time for no visible gain.
const MAX_FPS = 60;
const UPLOAD_CONCURRENCY = 8;

const CONTENT_TYPES: Record<string, string> = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
};

// A job killed mid-run (SIGKILL, OOM) never reaches its finally, so its source and renditions stay on
// disk. Concurrency is 1 and tmpdir is this container's own, so nothing else can be using these yet.
for (const entry of await readdir(tmpdir())) {
    if (entry.startsWith(WORKDIR_PREFIX)) await rm(path.join(tmpdir(), entry), { recursive: true, force: true });
}

async function downloadSource(storageKey: string, dest: string) {
    try {
        // To disk rather than piped into ffmpeg: phone MP4s often put the moov atom at the end,
        // which ffmpeg can only reach on seekable input.
        await storage.fGetObject(BUCKET, storageKey, dest);
    } catch (err) {
        // The original is gone, so no retry can bring it back. Anything else (network, MinIO) retries.
        // fGetObject stats first, and a HEAD 404 has no body, so minio reports it as NotFound, not NoSuchKey.
        const code = (err as { code?: string }).code;
        if (code === 'NotFound' || code === 'NoSuchKey') throw new UnrecoverableError(`original missing: ${storageKey}`);
        throw err;
    }
}

type ProbedVideo = {
    durationMs: number | null;
    // As displayed, i.e. after rotation, which is what the rendition ladder is sized from.
    width: number;
    height: number;
    fps: number | null;
    hasAudio: boolean;
};

type FfprobeStream = {
    codec_type?: string;
    width?: number;
    height?: number;
    duration?: string;
    avg_frame_rate?: string;
    disposition?: { attached_pic?: number };
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
};

async function probe(sourcePath: string): Promise<ProbedVideo> {
    let output: string;
    try {
        ({ stdout: output } = await execFileAsync('ffprobe', [
            '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', sourcePath,
        ]));
    } catch (err) {
        // ffprobe only fails like this on a file it can't parse; the bytes won't change on retry.
        const stderr = (err as { stderr?: string }).stderr?.trim();
        throw new UnrecoverableError(`ffprobe could not read the file: ${stderr || (err as Error).message}`);
    }

    const { streams = [], format = {} } = JSON.parse(output) as {
        streams?: FfprobeStream[];
        format?: { duration?: string };
    };
    // Cover art in audio files shows up as a one-frame video stream; it isn't a video.
    const videoStream = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    if (!videoStream?.width || !videoStream.height) throw new UnrecoverableError('no video stream');

    // Phones record sideways and store a rotation for players to apply; ffmpeg applies it when encoding.
    const rotation = videoStream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation
        ?? Number(videoStream.tags?.rotate ?? 0);
    const sideways = Math.abs(rotation) % 180 === 90;

    // MediaRecorder WebM often has no duration in its header; unknown isn't a reason to refuse it.
    const seconds = Number(format.duration ?? videoStream.duration);
    // A fraction like "30000/1001"; "0/0" when the container doesn't say.
    const [num, den] = (videoStream.avg_frame_rate ?? '').split('/').map(Number);
    const fps = num && den ? num / den : null;
    return {
        durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
        width: sideways ? videoStream.height : videoStream.width,
        height: sideways ? videoStream.width : videoStream.height,
        fps,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
    };
}

type Rendition = { shortSide: number; videoKbps: number };

function pickRenditions(probed: ProbedVideo): Rendition[] {
    const sourceShortSide = Math.min(probed.width, probed.height);
    const fitting = RENDITIONS.filter((r) => r.shortSide <= sourceShortSide);
    if (fitting.length > 0) return fitting;
    // Smaller than the lowest rung: one rendition at source size (x264 needs even dimensions).
    return [{ shortSide: sourceShortSide - (sourceShortSide % 2), videoKbps: RENDITIONS.at(-1)!.videoKbps }];
}

function hlsArgs(probed: ProbedVideo, renditions: Rendition[]): string[] {
    const portrait = probed.height > probed.width;
    const fpsCap = probed.fps && probed.fps > MAX_FPS ? `fps=${MAX_FPS},` : '';
    const labels = renditions.map((_, i) => `[s${i}]`).join('');
    // -2 keeps the aspect ratio and rounds the long side to an even number.
    const scales = renditions.map((r, i) =>
        `[s${i}]scale=${portrait ? `${r.shortSide}:-2` : `-2:${r.shortSide}`}[v${i}]`);
    const filter = [`[0:v]${fpsCap}split=${renditions.length}${labels}`, ...scales].join(';');

    return [
        '-hide_banner', '-nostdin', '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1',
        '-threads', String(ENCODE_THREADS), '-i', 'source',
        '-filter_complex_threads', String(ENCODE_THREADS), '-filter_complex', filter,
        // Each rendition gets its own copy of the audio, muxed into its segments.
        ...renditions.flatMap((_, i) => ['-map', `[v${i}]`, ...(probed.hasAudio ? ['-map', '0:a:0'] : [])]),
        // Backstop for sources whose duration probe couldn't read.
        '-t', String(MAX_DURATION_MS / 1000),
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
        // Per encoder: four renditions oversubscribe the cores a little, which keeps them busy while
        // the smaller renditions (fewer rows to split across threads) can't use their full share.
        '-threads', String(ENCODE_THREADS),
        // 10-bit and 4:2:2 sources (newer iPhones) would otherwise produce H.264 most players can't decode.
        '-pix_fmt', 'yuv420p',
        '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`, '-sc_threshold', '0',
        ...renditions.flatMap((r, i) => [
            `-b:v:${i}`, `${r.videoKbps}k`,
            `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.07)}k`,
            `-bufsize:v:${i}`, `${Math.round(r.videoKbps * 1.5)}k`,
        ]),
        ...(probed.hasAudio ? ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2', '-ar', '48000'] : []),
        '-f', 'hls',
        '-hls_time', String(SEGMENT_SECONDS),
        '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', 'hls/v%v/seg_%05d.ts',
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', renditions.map((_, i) => (probed.hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' '),
        'hls/v%v/index.m3u8',
    ];
}

// The one ffmpeg running at a time (concurrency is 1). Killed when the process exits, since a child
// isn't stopped by its parent dying and would otherwise keep encoding, e.g. across tsx watch restarts.
let activeFfmpeg: ChildProcess | undefined;
process.on('exit', () => activeFfmpeg?.kill('SIGKILL'));

function runFfmpeg(args: string[], cwd: string, onProgress?: (outTimeMs: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        activeFfmpeg = child;

        // Only the tail: ffmpeg's last lines say why it failed, and a long encode can log a lot.
        let stderrTail = '';
        child.stderr!.on('data', (chunk: Buffer) => {
            stderrTail = (stderrTail + chunk.toString()).slice(-4000);
        });
        // -progress writes key=value lines; out_time_us is how far into the source it has encoded.
        createInterface({ input: child.stdout! }).on('line', (line) => {
            const [key, value] = line.split('=');
            if (key === 'out_time_us' && onProgress) {
                const us = Number(value);
                if (Number.isFinite(us)) onProgress(us / 1000);
            }
        });

        // Spawn failures (ENOENT, EAGAIN) are about this machine, not the file, so they retry.
        child.once('error', reject);
        child.once('close', (code, signal) => {
            activeFfmpeg = undefined;
            if (code === 0) resolve();
            // Killed from outside (OOM, shutdown): the file may be fine, so let it retry.
            else if (signal) reject(new Error(`ffmpeg killed by ${signal}`));
            // A non-zero exit is almost always the input, and retrying a multi-hour encode of it is wasted.
            else reject(new UnrecoverableError(`ffmpeg exited with ${code}: ${stderrTail.trim()}`));
        });
    });
}

// A poster failing doesn't make the stream unplayable, so it's logged and skipped rather than thrown.
async function makePoster(workdir: string, probed: ProbedVideo, log: (msg: string) => void): Promise<string | null> {
    // 10% in skips the black or fade-in first frame most recordings open on.
    const atSeconds = probed.durationMs ? (probed.durationMs / 1000) * 0.1 : 0;
    try {
        await runFfmpeg([
            '-hide_banner', '-nostdin', '-y', '-v', 'error',
            '-ss', atSeconds.toFixed(3), '-i', 'source',
            '-frames:v', '1',
            '-vf', 'scale=400:400:force_original_aspect_ratio=decrease',
            '-c:v', 'libwebp', '-quality', '80',
            'poster.webp',
        ], workdir);
    } catch (err) {
        log(`poster failed, continuing without one: ${(err as Error).message}`);
        return null;
    }

    // Random for the same reason as image thumbnails: the thumb bucket is public.
    const thumbKey = `${nanoid(21)}.webp`;
    await storage.fPutObject(THUMB_BUCKET, thumbKey, path.join(workdir, 'poster.webp'), {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return thumbKey;
}

async function uploadHls(outDir: string, hlsPrefix: string): Promise<number> {
    const relPaths = (await readdir(outDir, { recursive: true })).filter((p) => path.extname(p) in CONTENT_TYPES);
    let next = 0;
    // A few at a time: one by one is slow for thousands of segments, all at once floods MinIO.
    await Promise.all(
        Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
            while (next < relPaths.length) {
                const rel = relPaths[next++]!;
                await storage.fPutObject(HLS_BUCKET, `${hlsPrefix}/${rel.split(path.sep).join('/')}`, path.join(outDir, rel), {
                    'Content-Type': CONTENT_TYPES[path.extname(rel)]!,
                    // VOD output never changes once the row says done, and nothing links to it before.
                    'Cache-Control': 'public, max-age=31536000, immutable',
                });
            }
        }),
    );
    return relPaths.length;
}

const formatMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function transcodeHls(job: Job<TranscodeHlsJob>) {
    const { fileId } = job.data;
    const log = (msg: string) => console.log(`[transcode ${fileId}] ${msg}`);
    const startedAt = Date.now();
    const [video] = await db
        .select({
            status: fileVideos.status,
            hlsPrefix: fileVideos.hlsPrefix,
            storageKey: files.storageKey,
            sizeBytes: files.sizeBytes,
            thumbKey: files.thumbKey,
        })
        .from(fileVideos)
        .innerJoin(files, eq(files.id, fileVideos.fileId))
        .where(eq(fileVideos.fileId, fileId));
    // Deleted or expired since enqueue (the cascade took the video row too), or a duplicate run of a
    // job that already finished: either way there's nothing to do.
    if (!video || video.status === 'done') {
        log(video ? 'already done, skipping' : 'file gone, skipping');
        return;
    }
    log(`started (attempt ${job.attemptsMade + 1}), source ${(video.sizeBytes / 1024 ** 2).toFixed(1)} MiB`);
    if (video.sizeBytes > MAX_SOURCE_BYTES) {
        throw new UnrecoverableError(`source is ${video.sizeBytes} bytes, over the ${MAX_SOURCE_BYTES} limit`);
    }

    // Unique per run, so a leftover from an earlier attempt can't be mistaken for this one's output.
    const workdir = await mkdtemp(path.join(tmpdir(), `${WORKDIR_PREFIX}${fileId}-`));
    try {
        const sourcePath = path.join(workdir, 'source');
        await downloadSource(video.storageKey, sourcePath);
        log(`downloaded in ${formatMs(Date.now() - startedAt)}`);

        const probed = await probe(sourcePath);
        if (probed.durationMs !== null && probed.durationMs > MAX_DURATION_MS) {
            throw new UnrecoverableError(`duration ${probed.durationMs}ms is over the ${MAX_DURATION_MS}ms limit`);
        }
        // Before the encode, which can take many minutes: upload lists and link previews get a thumbnail
        // within seconds, and keep it even if the transcode later fails. Skipped on a retry that already
        // made one, so attempts don't each leave an orphaned poster behind.
        if (!video.thumbKey) {
            const thumbKey = await makePoster(workdir, probed, log);
            if (thumbKey) {
                await db.update(files).set({ thumbKey }).where(eq(files.id, fileId));
                log(`poster saved as ${THUMB_BUCKET}/${thumbKey}`);
            }
        }

        const renditions = pickRenditions(probed);
        log(
            `probed ${probed.width}x${probed.height}` +
            ` ${probed.fps ? `${probed.fps.toFixed(2)}fps` : 'unknown fps'}` +
            ` ${probed.durationMs !== null ? formatMs(probed.durationMs) : 'unknown duration'}` +
            ` ${probed.hasAudio ? 'with' : 'no'} audio; renditions ${renditions.map((r) => `${r.shortSide}p`).join('/')}`,
        );

        await mkdir(path.join(workdir, 'hls'));
        const encodeStartedAt = Date.now();
        let lastLoggedPercent = 0;
        await runFfmpeg(hlsArgs(probed, renditions), workdir, (outTimeMs) => {
            if (!probed.durationMs) return;
            const percent = Math.min(100, Math.floor((outTimeMs / probed.durationMs) * 100));
            // Every 10%, so docker logs shows it moving without a line per second.
            if (percent >= lastLoggedPercent + 10) {
                lastLoggedPercent = percent - (percent % 10);
                log(`encoding ${lastLoggedPercent}% (${formatMs(Date.now() - encodeStartedAt)} elapsed)`);
                job.updateProgress(lastLoggedPercent).catch(() => {});
            }
        });
        log(`encoded in ${formatMs(Date.now() - encodeStartedAt)}`);

        const uploaded = await uploadHls(path.join(workdir, 'hls'), video.hlsPrefix);
        log(`uploaded ${uploaded} files to ${HLS_BUCKET}/${video.hlsPrefix}`);

        // Last, so a 'done' row never points at objects that aren't there yet.
        const masterKey = `${video.hlsPrefix}/master.m3u8`;
        await db
            .update(fileVideos)
            .set({
                status: 'done',
                error: null,
                masterKey,
                durationMs: probed.durationMs,
                width: probed.width,
                height: probed.height,
                hasAudio: probed.hasAudio,
                completedAt: new Date(),
            })
            .where(eq(fileVideos.fileId, fileId));
        log(`done in ${formatMs(Date.now() - startedAt)}, master ${HLS_BUCKET}/${masterKey}`);
    } finally {
        await rm(workdir, { recursive: true, force: true });
    }
}

const worker = new Worker<VideoProcessingJobData, void, VideoProcessingJobName>(
    VIDEO_PROCESSING_QUEUE,
    async (job) => transcodeHls(job),
    // A transcode uses every core ffmpeg is given; scale with replicas, not concurrency.
    { connection: redisConnection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
    console.error(`video-processing job ${job?.id} failed:`, err);
    if (!job) return;
    const { fileId } = job.data;

    // Only once BullMQ has given up; until then the row stays 'pending' and the job retries itself.
    const exhausted = err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted) return;
    console.error(`[transcode ${fileId}] failed for good: ${err.message}`);
    // Only from 'pending', so a late failure event can't overwrite a run that did finish.
    db.update(fileVideos)
        .set({ status: 'failed', error: err.message })
        .where(and(eq(fileVideos.fileId, fileId), eq(fileVideos.status, 'pending')))
        .catch((dbErr) => console.error(`could not mark video ${fileId} as failed:`, dbErr));
});

// Must stay under the service's stop_grace_period in docker compose, or Docker SIGKILLs first.
// Future scope: a transcode outlasts this, so a deploy kills the active job (ffmpeg dies with the process)
// and BullMQ restarts it from scratch as stalled; with the default maxStalledCount of 1 a second stall
// fails it. Planned fix: on SIGTERM kill ffmpeg, job.moveToDelayed(Date.now(), token) and throw
// DelayedError, so the job goes straight back to the queue without spending an attempt.
const SHUTDOWN_DEADLINE_MS = 28_000;

onShutdown('video-worker', SHUTDOWN_DEADLINE_MS, async () => {
    // Stops taking jobs and waits for the active one, up to the deadline.
    await worker.close();
    await redisConnection.quit();
    await pool.end();
});

console.log('Video worker listening on queue:', VIDEO_PROCESSING_QUEUE);
