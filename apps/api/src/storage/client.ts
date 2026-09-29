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

export async function ensureBucket() {
    const exists = await storage.bucketExists(BUCKET);
    if (!exists) {
        await storage.makeBucket(BUCKET, process.env.S3_REGION);
    }
}
