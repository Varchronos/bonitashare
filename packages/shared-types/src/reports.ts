// Why someone reports a file, in the order the report form lists them. Must match REPORT_REASONS in
// packages/core/src/db/schema/file_takedowns.ts; the API's routes/reports.ts fails to typecheck if
// the two drift apart.
export const REPORT_REASON_OPTIONS = [
  { value: 'csam', label: 'Child sexual abuse material', hint: 'Sexual content involving anyone under 18.' },
  { value: 'illegal', label: 'Illegal content', hint: 'Content that breaks the law, like terrorism or fraud.' },
  { value: 'copyright', label: 'Copyright infringement', hint: 'Someone else\'s work shared without permission.' },
  // Consensual sexual content between adults is allowed; this reason is only for content without consent.
  { value: 'nudity', label: 'Non-consensual intimate images', hint: 'Sexual or nude content of someone who didn\'t agree to it being shared.' },
  { value: 'harassment', label: 'Harassment or hate', hint: 'Targets a person or group, or reveals private information.' },
  { value: 'malware', label: 'Malware or phishing', hint: 'Viruses, scams, or a page that tries to steal logins.' },
  { value: 'spam', label: 'Spam', hint: 'Unwanted ads or mass-shared junk.' },
  { value: 'other', label: 'Something else', hint: 'Tell us what\'s wrong in the details below.' },
] as const

export type ReportReason = (typeof REPORT_REASON_OPTIONS)[number]['value']

// The optional free-text part of a report.
export const REPORT_DETAILS_MAX_LENGTH = 1000

// POST /reports body. Only files can be reported so far; albums join once they have pages.
export type ReportRequest = {
  kind: 'file'
  id: string
  reason: ReportReason
  details?: string
}

// GET /admin/reports: the moderation table, one row per reported file.
export type AdminReportSort = 'newest' | 'oldest'

export type AdminReport = {
  id: string
  reason: ReportReason
  details: string | null
  status: 'open' | 'actioned' | 'dismissed'
  // Null once the reporter deleted their account.
  reporterEmail: string | null
  createdAt: string
}

export type AdminReportedFile = {
  fileId: string
  // Null once the file itself is gone (purged); reports outlive it.
  filename: string | null
  contentType: string | null
  // Null for anonymous uploads, deleted accounts, and purged files.
  ownerEmail: string | null
  // The owner soft-deleted it; it can still come back for a day.
  deletedByOwner: boolean
  // Set once moderation has acted on it.
  takedownState: 'hidden' | 'removed' | 'held' | null
  // A removed file's scheduled content purge; null otherwise.
  purgeContentAfter: string | null
  // The purge has run: the original is gone and the takedown can't be undone.
  contentPurged: boolean
  reportCount: number
  openCount: number
  // How many reports gave each reason, most first.
  reasons: { reason: ReportReason; count: number }[]
  firstReportedAt: string
  lastReportedAt: string
  // Newest first.
  reports: AdminReport[]
}

export type AdminReportPage = {
  files: AdminReportedFile[]
  page: number
  hasNextPage: boolean
}
