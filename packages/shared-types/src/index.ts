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