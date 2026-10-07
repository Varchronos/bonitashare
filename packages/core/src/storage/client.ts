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
