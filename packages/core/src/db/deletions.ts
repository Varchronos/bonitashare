import { sql } from 'drizzle-orm';
import { fileDeletions, files } from './schema.js';

// For a WHERE over files: true when the file hasn't been soft-deleted. An anti-join on
// file_deletions' primary key, so it adds no index to files.
export const notDeleted = () =>
    sql`NOT EXISTS (SELECT 1 FROM ${fileDeletions} WHERE ${fileDeletions.fileId} = ${files.id})`;
