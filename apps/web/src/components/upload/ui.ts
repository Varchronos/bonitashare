// Class lists shared by the upload lists' rows: TaskRow, UserFiles and DeletedFiles all render the same row.

export const row = 'flex gap-4 rounded-lg border border-border bg-surface p-3';
export const rowBody = 'flex min-w-0 flex-1 flex-col gap-2';
// The filename line and the status line under it.
export const rowLine = 'flex items-center justify-between gap-3';
export const fileName = 'min-w-0 flex-1 truncate font-medium text-fg';
export const rowActions = 'flex shrink-0 gap-2';
export const iconButton = 'flex cursor-pointer items-center justify-center p-0.5 text-muted hover:text-danger';

const tones = { muted: 'text-muted', error: 'text-danger', success: 'text-success' };
export const statusText = (tone: keyof typeof tones = 'muted') => `min-w-0 truncate text-sm ${tones[tone]}`;
export const statusAside = 'shrink-0 text-sm text-muted';

export const linkRow = 'flex items-center gap-3';
export const linkUrl = 'min-w-0 flex-1 truncate text-sm text-accent hover:underline';

export const smallButton =
	'cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs text-fg hover:border-accent hover:text-accent';
export const moreButton =
	'cursor-pointer self-start rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent hover:text-accent';
