import { pgTable, text, uuid, bigint, boolean, timestamp, integer, primaryKey, index, uniqueIndex, varchar, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: varchar('display_name', { length: 50 }),
    // Set only once the signup OTP is verified. Stored lowercased; the unique index below enforces that too.
    email: text('email'),
    // argon2id, encoded with its parameters.
    passwordHash: text('password_hash'),
    // Anonymous isn't a plan: it's implied by a null email.
    plan: text('plan', { enum: ['free', 'pro'] }).notNull().default('free'),
    // Null for free. Pro only counts while this is in the future, so a missed payment webhook can't leave it on forever.
    planExpiresAt: timestamp('plan_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('users_email_requires_password_hash', sql`${table.email} IS NULL OR ${table.passwordHash} IS NOT NULL`),
    // Case-insensitive, so A@x.com and a@x.com can't be two accounts. Partial: anonymous users have no email.
    uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`).where(sql`${table.email} IS NOT NULL`),
]);

export const userSessions = pgTable('user_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    // Parsed from userAgent when the session is issued, for the list of signed-in devices. Null when it can't tell.
    deviceType: text('device_type', { enum: ['mobile', 'tablet', 'desktop'] }),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One-time codes sent by email. At most one live code per (email, purpose): a resend replaces the row,
// so its old code stops working and createdAt doubles as the resend cooldown's clock.
export const emailOtps = pgTable('email_otps', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Where the code was sent, lowercased. For change_email that's the new address.
    email: text('email').notNull(),
    purpose: text('purpose', { enum: ['signup', 'reset_password', 'change_email'] }).notNull(),
    // The user the code acts on: for signup, the anonymous user to upgrade, so only the browser that asked can claim it.
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 of the code; never the code itself.
    codeHash: text('code_hash').notNull(),
    // Wrong guesses so far. A 6-digit code is only a million options, so the code dies after a few.
    attempts: integer('attempts').notNull().default(0),
    // Signup only: what gets copied onto the user once the code is verified, so an unverified email never lands in users.
    passwordHash: text('password_hash'),
    displayName: varchar('display_name', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
    uniqueIndex('email_otps_email_purpose_idx').on(table.email, table.purpose),
    check('email_otps_signup_has_password', sql`${table.purpose} <> 'signup' OR ${table.passwordHash} IS NOT NULL`),
]);

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
    // Backs the storage quota sum over a user's files.
    index('files_owner_id_idx').on(table.ownerId).where(sql`${table.ownerId} IS NOT NULL`),
    // Backs the newest-first, keyset-paginated list of a user's files (GET /files).
    index('files_owner_uploaded_idx').on(table.ownerId, table.uploadedAt.desc(), table.id.desc()).where(sql`${table.fileStatus} = 'uploaded'`),
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

// Soft deletes: a file with a row here is gone to everyone (404s, off the user's list, out of the storage
// quota) but can be restored until purgeAfter, when the worker's purge sweep deletes its objects and the
// files row. Kept out of files so its write-heavy indexes don't grow another column to maintain.
export const fileDeletions = pgTable('file_deletions', {
    fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    // Set by the database clock at delete time; restore and the purge sweep both compare it to now().
    purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
}, (table) => [
    // Backs the purge sweep, which only looks for rows past purgeAfter.
    index('file_deletions_purge_after_idx').on(table.purgeAfter),
]);

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

export const uploadUsage = pgTable('upload_usage', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Null once the file is deleted; the row still counts toward the weekly quota.
    fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),
    // Reserved as the full upload size at create, lowered to the bytes actually received if it never finishes.
    bytesConsumed: bigint('bytes_consumed', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // Backs the weekly quota sum: one user's rows within the last 7 days.
    index('upload_usage_user_created_idx').on(table.userId, table.createdAt),
    // Backs the purge sweep, which drops rows older than 7 days.
    index('upload_usage_created_idx').on(table.createdAt),
]);
