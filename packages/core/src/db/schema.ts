import { pgTable, text, uuid, bigint, boolean, timestamp, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('users_with_email_idx').on(table.email).where(sql`${table.email} IS NOT NULL`)]);

export const userSessions = pgTable('user_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const files = pgTable('files', {
    id: text('id').primaryKey(), // short random link id, generated in app code
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull(), // key inside MinIO/S3 bucket
    thumbKey: text('thumb_key'), // key of generated thumbnail (either thumb or video preview); null until generated (or if not applicable)
    filename: text('filename').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    fileStatus: text('file_status', { enum: ['pending', 'uploading', 'uploaded', 'failed'] }).notNull().default('pending'),
    // When the last byte landed — createdAt is when the upload started, which can be hours earlier.
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    // Post-upload work (thumbnails etc.), kept apart from fileStatus: a failed thumbnail doesn't make the file unservable.
    processingStatus: text('processing_status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
}, (table) => [
    index('files_expires_at_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
    // Backs the reconcile sweep, which only ever looks for uploaded files still awaiting processing.
    index('files_unprocessed_idx').on(table.uploadedAt).where(sql`${table.fileStatus} = 'uploaded' AND ${table.processingStatus} = 'pending'`),
]);

// HLS output for video files, written by the video-worker once transcoding finishes.
export const fileVideos = pgTable('file_videos', {
    fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
    error: text('error'),
    // Random prefix in the public HLS bucket, chosen at enqueue so every retry writes to the same keys.
    hlsPrefix: text('hls_prefix').notNull(),
    masterKey: text('master_key'), // key of the master playlist (.m3u8)
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    hasAudio: boolean('has_audio'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const albums = pgTable('albums', {
    id: text('id').primaryKey(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    desc: text('desc'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// join table modeling many-to-many relationship between albums and files
// one album has many files and one file can be in many albums.
export const albumFiles = pgTable('album_files', {
    albumId: text('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [{
    pk: primaryKey({ columns: [table.albumId, table.fileId] }),
}]);


// Added ahead of the AI summarization phase — status lets the frontend know
// whether to render a summary, a "processing" placeholder, or nothing.
export const fileAiSummary = pgTable('file_ai_summary', {
    fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'cascade' }),
    summaryText: text('summary_text'),
    tags: text('tags').array(),
    modelUsed: text('model_used'),
    status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});