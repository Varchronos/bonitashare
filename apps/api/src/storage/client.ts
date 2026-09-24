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

export const BUCKET = process.env.S3_BUCKET!;

export async function ensureBucket() {
    const exists = await storage.bucketExists(BUCKET);
    if (!exists) {
        await storage.makeBucket(BUCKET, process.env.S3_REGION);
    }
}
