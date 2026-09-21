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
