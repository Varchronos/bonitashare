import { toBytes } from "./utils/byte-conversion.js";

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: {
    message: string;
    code: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;


export enum FileStatus {
  pending = 'pending',
  uploading = 'uploading',
  uploaded = 'uploaded',
  failed = 'failed'
}

export type FileItem = {
  id: string
  ownerId: string | null
  storageKey: string
  thumbKey: string | null
  filename: string
  contentType: string
  sizeBytes: number
  isPublic: boolean
  fileStatus: FileStatus
  createdAt: Date
  expiresAt: Date | null
}

// One of the signed-in user's finished uploads, as GET /files lists them.
export type UserFile = {
  id: string
  filename: string
  contentType: string | null
  sizeBytes: number
  isPublic: boolean
  // Null until the worker has made one, or for files that don't get thumbnails.
  thumbnailUrl: string | null
  uploadedAt: string
  expiresAt: string | null
}

export type FilePage = {
  files: UserFile[]
  // Pass back as ?cursor= for the next page; null on the last one.
  nextCursor: string | null
}

// A soft-deleted file, as GET /files/deleted lists them: restorable until purgeAfter.
export type DeletedFile = {
  id: string
  filename: string
  contentType: string | null
  sizeBytes: number
  thumbnailUrl: string | null
  deletedAt: string
  purgeAfter: string
}

// POST /auth/signup and /auth/signup/resend: a code is on its way to `email`.
export type OtpSent = {
  email: string
  expiresAt: string
  // The earliest a resend is accepted.
  resendAfter: string
}

// POST /auth/signup/verify: the browser's user now has this account, under a new session cookie.
export type SignedUp = {
  userId: string
  email: string
  displayName: string | null
}

export * from './tiers.js'
export * from './utils/byte-conversion.js'