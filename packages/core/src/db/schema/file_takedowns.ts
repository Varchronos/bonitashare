import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { files, users } from "../schema.js";

export const REPORT_REASONS = ['csam', 'illegal', 'copyright', 'nudity', 'harassment', 'malware', 'spam', 'other'] as const;
const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export const TAKEDOWN_STATES = ['hidden', 'removed', 'held'] as const;
export const TAKEDOWN_SOURCES = ['report', 'auto', 'admin', 'legal', 'copyright'] as const;
const TAKEDOWN_ACTIONS = ['hide', 'remove', 'hold', 'release', 'dismiss', 'appeal', 'purge_content'] as const;

// drizzle's text enums are only checked in TypeScript; this makes the database reject other values too.
// The values are our own constants, so sql.raw is safe here.
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
    sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

// One row per (reporter, artifact): a repeat report updates the row. fileId and albumId are plain ids,
// not foreign keys, so the report history outlives a purged file or a deleted album.
export const reports = pgTable('reports', {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: text('file_id'),
    albumId: text('album_id'),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    reporterIp: text('reporter_ip'),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    details: text('details'),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
    check('reports_one_artifact', sql`num_nonnulls(${table.fileId}, ${table.albumId}) = 1`),
    check('reports_reason_valid', oneOf(table.reason, REPORT_REASONS)),
    check('reports_status_valid', oneOf(table.status, REPORT_STATUSES)),
    uniqueIndex('reports_reporter_file_idx').on(table.reporterId, table.fileId).where(sql`${table.fileId} IS NOT NULL`),
    uniqueIndex('reports_reporter_album_idx').on(table.reporterId, table.albumId).where(sql`${table.albumId} IS NOT NULL`),
    // Backs the moderation queue, oldest open reports first.
    index('reports_status_created_idx').on(table.status, table.createdAt),
]);

// A file blocked by moderation. Unlike file_deletions the owner can't undo it. Restrict, so nothing can
// delete the files row (and the evidence) while this exists: the purge and expiry sweeps must skip these.
export const fileTakedowns = pgTable('file_takedowns', {
    fileId: text('file_id').primaryKey().references(() => files.id, { onDelete: 'restrict' }),
    state: text('state', { enum: TAKEDOWN_STATES }).notNull(),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    source: text('source', { enum: TAKEDOWN_SOURCES }).notNull(),
    sha256: text('sha256'),
    // Copied at takedown time: files.ownerId goes null when the account is deleted.
    ownerIdSnapshot: uuid('owner_id_snapshot'),
    ownerEmailSnapshot: text('owner_email_snapshot'),
    // Null while hidden or held; set when removed, for the sweep that deletes the original.
    purgeContentAfter: timestamp('purge_content_after', { withTimezone: true }),
    contentPurgedAt: timestamp('content_purged_at', { withTimezone: true }),
    appealText: text('appeal_text'),
    appealedAt: timestamp('appealed_at', { withTimezone: true }),
    appealResolvedAt: timestamp('appeal_resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('file_takedowns_state_valid', oneOf(table.state, TAKEDOWN_STATES)),
    check('file_takedowns_reason_valid', oneOf(table.reason, REPORT_REASONS)),
    check('file_takedowns_source_valid', oneOf(table.source, TAKEDOWN_SOURCES)),
    // Backs the strike count per uploader.
    index('file_takedowns_owner_snapshot_idx').on(table.ownerIdSnapshot).where(sql`${table.ownerIdSnapshot} IS NOT NULL`),
    // Backs the sweep that deletes removed originals once retention ends.
    index('file_takedowns_purge_content_idx').on(table.purgeContentAfter).where(sql`${table.contentPurgedAt} IS NULL`),
]);

// Append-only history of takedown actions; never updated or deleted. fileId is a plain id so it outlives the file.
export const takedownEvents = pgTable('takedown_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: text('file_id').notNull(),
    action: text('action', { enum: TAKEDOWN_ACTIONS }).notNull(),
    actorId: uuid('actor_id'), // null when the system did it (auto-hide, sweep)
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('takedown_events_action_valid', oneOf(table.action, TAKEDOWN_ACTIONS)),
    index('takedown_events_file_idx').on(table.fileId, table.at),
]);

// For a WHERE over files: true when moderation hasn't taken the file down in any state. Like notDeleted,
// an anti-join on the primary key. Anything shown to the public (share links, "Shared with you",
// reporting) uses this; the owner's and admins' own views check the state themselves.
export const notTakenDown = () =>
    sql`NOT EXISTS (SELECT 1 FROM ${fileTakedowns} WHERE ${fileTakedowns.fileId} = ${files.id})`;
