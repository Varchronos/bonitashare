import { useEffect, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatBytes, type FilePage, type UserFile } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { shareIdFor } from '../../lib/upload-task';
import { fetchFiles } from '../../lib/files';
import { copyLink } from './TaskRow';
import { CloseIcon, GridIcon, ListIcon, SearchIcon, TrashIcon } from './icons';
import FileThumb from './FileThumb';
import ShareLinks from './ShareLinks';
import { useDeleteFile } from './useDeleteFile';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useStoredState } from '../../hooks/useStoredState';
import SortMenu, { type SortValue } from '../SortMenu';
import { DEFAULT_FILE_SORT, FILE_SORT_OPTIONS, fileCategory, groupByCategory, sortFiles, type FileSortKey } from '../../lib/file-sort';

type View = 'grid' | 'list';

const isView = (v: unknown): v is View => v === 'grid' || v === 'list';
const isFileSort = (v: unknown): v is SortValue<FileSortKey> =>
	typeof v === 'object' &&
	v !== null &&
	FILE_SORT_OPTIONS.some((o) => o.value === (v as SortValue<FileSortKey>).key) &&
	['asc', 'desc'].includes((v as SortValue<FileSortKey>).dir);

// The user's finished uploads, from the server a page at a time. Uploads still in the local store
// (in progress, or finished during this visit) are left out here: TaskList already shows them.
// With `limit`, only the newest few, and a link to the upload page in place of "Load more".
export default function UserFiles({ initial, limit }: { initial: FilePage | null; limit?: number }) {
	const [files, setFiles] = useState<UserFile[]>(initial?.files ?? []);
	const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
	const localIds = useUploadStore(useShallow((s) => s.files.map(shareIdFor)));
	// This also renders on the server, which has no window; links are relative until hydrated.
	const [origin, setOrigin] = useState('');
	const [query, setQuery] = useState('');
	const [sort, setSort] = useStoredState('userFiles.sort', DEFAULT_FILE_SORT, isFileSort);
	const [view, setView] = useStoredState<View>('userFiles.view', 'grid', isView);

	const { trigger: load, isPending: loading, isError: failed } = useAsyncAction({
		triggerFn: fetchFiles,
		onSuccess: (page) => {
			// Keyed by id: an upload finishing between two fetches shifts the pages, and the same file
			// could otherwise come back twice.
			setFiles((prev) => {
				const seen = new Set(prev.map((f) => f.id));
				return [...prev, ...page.files.filter((f) => !seen.has(f.id))];
			});
			setCursor(page.nextCursor);
		},
	});

	// The page couldn't fetch the first page while rendering; try again from here.
	useEffect(() => {
		setOrigin(window.location.origin);
		if (!initial) load(null);
	}, []);

	const visible = files.filter((f) => !localIds.includes(f.id)).slice(0, limit);
	if (visible.length === 0 && (!cursor || limit) && !failed) return null;

	// The short "Recent uploads" list keeps upload order and cards; the tools are for the full list.
	const showTools = !limit;
	const needle = query.trim().toLowerCase();
	// Plain substring match for now (fuzzy search comes later). Only pages loaded so far are searched.
	const matching = showTools && needle ? visible.filter((f) => f.filename.toLowerCase().includes(needle)) : visible;
	const sorted = showTools ? sortFiles(matching, sort) : matching;
	const activeView = showTools ? view : 'grid';

	const renderList = (list: UserFile[]) => (
		<FileList view={activeView}>
			{list.map((file) => (
				<FileRow
					key={file.id}
					file={file}
					origin={origin}
					view={activeView}
					onDeleted={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
				/>
			))}
		</FileList>
	);

	return (
		<section className="mt-8 flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-title">{limit ? 'Recent uploads' : 'Your files'}</h2>
				{showTools && (
					<div className="flex w-full items-center gap-1 sm:w-auto">
						<label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-container-high px-4 text-on-surface-variant focus-within:outline-2 focus-within:outline-primary sm:w-64 sm:flex-none">
							<SearchIcon />
							<input
								type="search"
								className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:hidden"
								placeholder="Search your files"
								aria-label="Search your files by name"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
							/>
							{query && (
								<button type="button" className="-mr-2 icon-btn icon-btn-sm" aria-label="Clear search" onClick={() => setQuery('')}>
									<CloseIcon />
								</button>
							)}
						</label>
						<SortMenu options={FILE_SORT_OPTIONS} value={sort} onChange={setSort} defaultValue={DEFAULT_FILE_SORT} />
						<button
							type="button"
							className="icon-btn"
							aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to card view'}
							title={view === 'grid' ? 'List view' : 'Card view'}
							onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
						>
							{view === 'grid' ? <ListIcon /> : <GridIcon />}
						</button>
					</div>
				)}
			</div>
			{sorted.length === 0 && needle ? (
				<p className="card p-6 text-center text-sm text-on-surface-variant">
					No files match “{query.trim()}”.{cursor && ' Only the files loaded so far were searched; load more to search further.'}
				</p>
			) : showTools && sort.key === 'type' ? (
				groupByCategory(sorted).map((group) => (
					<div key={group.category} className="flex flex-col gap-2">
						<h3 className="pt-2 text-sm font-medium text-on-surface-variant">
							{group.category} <span className="font-normal">· {group.files.length}</span>
						</h3>
						{renderList(group.files)}
					</div>
				))
			) : (
				renderList(sorted)
			)}
			{failed && <span className="text-sm text-error">Couldn't load your files.</span>}
			{(failed || (cursor && !limit)) && (
				<button type="button" className="btn btn-outlined self-start" disabled={loading} onClick={() => load(cursor)}>
					{loading ? 'Loading…' : failed ? 'Try again' : 'Load more'}
				</button>
			)}
			{limit && !failed && (
				<a href="/upload" className="btn btn-tonal self-start">
					View all uploads →
				</a>
			)}
		</section>
	);
}

function FileList({ view, children }: { view: View; children: ReactNode }) {
	return view === 'grid' ? (
		<ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">{children}</ul>
	) : (
		<ul className="card flex flex-col divide-y divide-outline-variant/60 overflow-hidden">{children}</ul>
	);
}

function FileRow({ file, origin, view, onDeleted }: { file: UserFile; origin: string; view: View; onDeleted: () => void }) {
	const { remove, deleting, error } = useDeleteFile(file.id, file.filename, onDeleted);
	const isVideo = file.contentType?.startsWith('video/') ?? false;
	const link = `${origin}/f/${file.id}`;

	if (view === 'list') {
		return (
			<li className="flex min-w-0 items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-container-high">
				<div className="w-16 shrink-0 sm:w-20">
					<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<a href={link} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-on-surface hover:underline">
						{file.filename}
					</a>
					{error ? (
						<span className="truncate text-xs text-error">{error}</span>
					) : (
						<span className="truncate text-xs text-on-surface-variant">
							{formatBytes(file.sizeBytes)} · {fileCategory(file.contentType)} · {new Date(file.uploadedAt).toLocaleDateString()}
							{file.expiresAt && ` · Expires ${new Date(file.expiresAt).toLocaleDateString()}`}
						</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button type="button" className="btn btn-tonal btn-sm" onClick={() => copyLink(link)}>
						Copy
					</button>
					<span className="hidden sm:contents">
						<ShareLinks link={link} />
					</span>
					<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Delete" disabled={deleting} onClick={remove}>
						<TrashIcon />
					</button>
				</div>
			</li>
		);
	}

	return (
		<li className="card flex min-w-0 flex-col p-2 transition-colors hover:bg-surface-container-high">
			<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
			<div className="flex min-w-0 flex-1 flex-col gap-2 px-2 pt-3 pb-1">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">{file.filename}</span>
					<div className="-mr-1 flex shrink-0 items-center">
						<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Delete" disabled={deleting} onClick={remove}>
							<TrashIcon />
						</button>
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					{error ? (
						<span className="min-w-0 truncate text-xs text-error">{error}</span>
					) : (
						<span className="min-w-0 truncate text-xs text-on-surface-variant">{formatBytes(file.sizeBytes)}</span>
					)}
					{file.expiresAt && (
						<span className="shrink-0 text-xs text-on-surface-variant">Expires {new Date(file.expiresAt).toLocaleDateString()}</span>
					)}
				</div>
				<a href={link} target="_blank" rel="noreferrer" className="truncate text-xs text-primary hover:underline">
					{link}
				</a>
				<div className="flex flex-wrap items-center gap-1">
					<button type="button" className="btn btn-tonal btn-sm" onClick={() => copyLink(link)}>
						Copy
					</button>
					<ShareLinks link={link} />
				</div>
			</div>
		</li>
	);
}
