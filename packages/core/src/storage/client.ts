import { Client } from "minio";

// Defaults to the internal endpoint (S3_ENDPOINT). Pass another endpoint for a client that signs
// URLs browsers can reach; credentials and addressing style are shared.
export function createStorage(endpointUrl: string = process.env.S3_ENDPOINT!) {
    const endpoint = new URL(endpointUrl);

    return new Client({
        endPoint: endpoint.hostname,
        port: endpoint.port ? Number(endpoint.port) : undefined,
        useSSL: endpoint.protocol === "https:",
        accessKey: process.env.S3_ACCESS_KEY,
        secretKey: process.env.S3_SECRET_KEY,
        region: process.env.S3_REGION,
        pathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
}

export const BUCKET = process.env.S3_BUCKET!;

// Anonymous-read bucket so thumbnails are served straight to browsers (and CDNs) without presigning.
export const THUMB_BUCKET = process.env.S3_THUMB_BUCKET!;

// Anonymous-read bucket for HLS playlists and segments, so players fetch them without presigning
// every segment. Keys sit under a random per-video prefix, never the share id.
export const HLS_BUCKET = process.env.S3_HLS_BUCKET!;

// Deletes keys in one request. Per-key failures come back in the response rather than as a throw, so
// they're turned into one here. Removing a key that's already gone is fine.
export async function removeObjects(storage: Client, bucket: string, keys: string[]) {
    if (keys.length === 0) return;
    const failed = (await storage.removeObjects(bucket, keys)).filter((r) => r?.Error);
    if (failed.length > 0) {
        throw new Error(`could not remove ${failed.length} objects from ${bucket}: ${failed[0]!.Error!.Code} ${failed[0]!.Error!.Message}`);
    }
}

// Every key under a prefix, e.g. one video's HLS output. Give the prefix a trailing slash, so one prefix
// doesn't also match another that starts with it.
export async function listKeys(storage: Client, bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const item of storage.listObjectsV2(bucket, prefix, true)) {
        if (item.name) keys.push(item.name);
    }
    return keys;
}
