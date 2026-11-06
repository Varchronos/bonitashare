// Moderation actions on a file, as the admin takedown tool offers them. Values match TAKEDOWN_STATES and
// TAKEDOWN_SOURCES in packages/core/src/db/schema/file_takedowns.ts. and must be in sync

export const TAKEDOWN_STATE_OPTIONS = [
  { value: 'hidden', label: 'Hidden', hint: "Nobody but admins can open it. Nothing is deleted, and it can be released again." },
  { value: 'held', label: 'Held', hint: 'Hidden, and kept as evidence: no sweep can delete it while the hold lasts.' },
  { value: 'removed', label: 'Removed', hint: 'Hidden for good. The original is deleted once the purge time passes.' },
] as const

export type TakedownState = (typeof TAKEDOWN_STATE_OPTIONS)[number]['value']

// Who asked for a takedown made by hand. 'report' and 'auto' are set by the system, not picked here.
export const TAKEDOWN_SOURCE_OPTIONS = [
  { value: 'admin', label: 'Admin decision' },
  { value: 'legal', label: 'Legal request' },
  { value: 'copyright', label: 'Copyright notice' },
] as const

export type ManualTakedownSource = (typeof TAKEDOWN_SOURCE_OPTIONS)[number]['value']

// When a removed file's original is deleted. Only applies to 'removed'.
export const TAKEDOWN_PURGE_OPTIONS = [
  { value: 'immediate', label: 'Immediately', hint: 'Deleted at the next purge sweep.' },
  { value: '30d', label: 'After 30 days', hint: 'Kept for 30 days in case of an appeal, then deleted.' },
] as const

export type TakedownPurge = (typeof TAKEDOWN_PURGE_OPTIONS)[number]['value']

// POST /admin/files/:id/takedown body. purge only counts for 'removed', and is required then.
export type TakedownRequest = {
  state: TakedownState
  reason: import('./reports.js').ReportReason
  source: ManualTakedownSource
  purge?: TakedownPurge
}

// A file's takedown as the owner and admins see it (on the share page, and as the takedown route's answer).
export type FileTakedown = {
  state: TakedownState
  reason: import('./reports.js').ReportReason
  // When a removed file's original is deleted; null for hidden and held.
  purgeContentAfter: string | null
}
