import { Client } from "minio";

const endpoint = new URL(process.env.S3_ENDPOINT!);

export const storage = new Client({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : undefined,
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION,
    pathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

// Signs URLs against the endpoint browsers can actually reach — `storage`
// above points at the internal docker hostname, which only resolves
// server-to-server. Falls back to S3_ENDPOINT for hosted S3/R2 setups where
// there's no internal-vs-public split.
const publicEndpoint = new URL(process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT!);

export const publicStorage = new Client({
    endPoint: publicEndpoint.hostname,
    port: publicEndpoint.port ? Number(publicEndpoint.port) : undefined,
    useSSL: publicEndpoint.protocol === "https:",
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION,
    pathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

export const BUCKET = process.env.S3_BUCKET!;

// Anonymous-read bucket so thumbnails are served straight to browsers (and CDNs) without presigning.
export const THUMB_BUCKET = process.env.S3_THUMB_BUCKET!;

// Where browsers fetch thumbnails from. Defaults to path-style on the public S3 endpoint; point it at
// a CDN or R2 custom domain in prod.
const THUMB_PUBLIC_BASE_URL = (process.env.THUMB_PUBLIC_BASE_URL || `${publicEndpoint.origin}/${THUMB_BUCKET}`).replace(/\/$/, '');

export const thumbUrl = (thumbKey: string) => `${THUMB_PUBLIC_BASE_URL}/${thumbKey}`;

// GetObject only, no ListBucket, so keys can't be enumerated.
const publicReadPolicy = (bucket: string) =>
    JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }],
    });

// True only for the caller that actually created it. Replicas start together, so another one can
// create the bucket between our exists check and makeBucket; losing that race isn't an error.
async function createBucketIfMissing(bucket: string): Promise<boolean> {
    if (await storage.bucketExists(bucket)) return false;
    try {
        await storage.makeBucket(bucket, process.env.S3_REGION);
        return true;
    } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') return false;
        throw err;
    }
}

export async function ensureBucket() {
    await createBucketIfMissing(BUCKET);

    // The public policy is applied only when this creates the bucket. A pre-provisioned one (prod) is
    // left alone, since public access is configured differently per provider (R2 has no bucket policies).
    if (await createBucketIfMissing(THUMB_BUCKET)) {
        await storage.setBucketPolicy(THUMB_BUCKET, publicReadPolicy(THUMB_BUCKET));
    }
}
