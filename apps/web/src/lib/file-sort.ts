import type { SortOption, SortValue } from '../components/SortMenu';

export type FileSortKey = 'uploaded' | 'name' | 'size' | 'type';

export const FILE_SORT_OPTIONS: SortOption<FileSortKey>[] = [
	{ value: 'uploaded', label: 'Date uploaded', directions: ['Oldest first', 'Newest first'], defaultDir: 'desc' },
	{ value: 'name', label: 'Name', directions: ['A → Z', 'Z → A'] },
	{ value: 'size', label: 'Size', directions: ['Smallest first', 'Largest first'], defaultDir: 'desc' },
	{ value: 'type', label: 'File type' },
];

// Newest first: the order the server sends them in.
export const DEFAULT_FILE_SORT: SortValue<FileSortKey> = { key: 'uploaded', dir: 'desc' };

type SortableFile = { filename: string; sizeBytes: number; uploadedAt: string; contentType: string | null };

// Numeric so "file 2" comes before "file 10"; base sensitivity so case and accents don't split names apart.
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortFiles<F extends SortableFile>(files: F[], { key, dir }: SortValue<FileSortKey>): F[] {
	// Grouping keeps upload order inside each group; groupByCategory does the rest.
	if (key === 'type') return files;
	const sign = dir === 'asc' ? 1 : -1;
	return [...files].sort((a, b) => {
		if (key === 'name') return sign * nameCollator.compare(a.filename, b.filename);
		if (key === 'size') return sign * (a.sizeBytes - b.sizeBytes);
		return sign * a.uploadedAt.localeCompare(b.uploadedAt);
	});
}

// Groups in the order they're listed when sorting by type.
const CATEGORIES = ['Images', 'Videos', 'Audio', 'Documents', 'Archives', 'Other'] as const;
export type FileCategory = (typeof CATEGORIES)[number];

const DOCUMENT_TYPES = /^(application\/(pdf|msword|rtf|vnd\.(openxmlformats-officedocument|oasis\.opendocument|ms-excel|ms-powerpoint)[^;]*)|text\/)/;
const ARCHIVE_TYPES = /^application\/(zip|x-zip-compressed|x-7z-compressed|x-rar-compressed|vnd\.rar|x-tar|gzip|x-gzip|x-bzip2|x-xz|zstd)$/;

export function fileCategory(contentType: string | null): FileCategory {
	if (!contentType) return 'Other';
	if (contentType.startsWith('image/')) return 'Images';
	if (contentType.startsWith('video/')) return 'Videos';
	if (contentType.startsWith('audio/')) return 'Audio';
	if (DOCUMENT_TYPES.test(contentType)) return 'Documents';
	if (ARCHIVE_TYPES.test(contentType)) return 'Archives';
	return 'Other';
}

// Non-empty groups only, in CATEGORIES order.
export function groupByCategory<F extends SortableFile>(files: F[]): { category: FileCategory; files: F[] }[] {
	const groups = new Map<FileCategory, F[]>();
	for (const file of files) {
		const category = fileCategory(file.contentType);
		groups.set(category, [...(groups.get(category) ?? []), file]);
	}
	return CATEGORIES.filter((c) => groups.has(c)).map((category) => ({ category, files: groups.get(category)! }));
}
