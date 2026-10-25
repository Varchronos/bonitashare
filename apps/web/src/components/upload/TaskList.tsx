import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUploadStore } from '../../store/file-store';
import TaskRow from './TaskRow';

const MAX_VISIBLE = 6;

export default function TaskList() {
	// Shallow-compared id list only: `updateFile` always returns a new
	// `files` array, but `useShallow` keeps this from re-rendering (and
	// re-mapping every row) on every progress tick — only an actual add,
	// remove, or reorder changes the id list itself.
	const ids = useUploadStore(useShallow((s) => s.files.map((f) => f.id)));
	const [expanded, setExpanded] = useState(false);

	if (ids.length === 0) return null;

	// The store keeps insertion order, so "visible" is its tail — the most
	// recently added uploads — reversed to show newest first.
	const visibleIds = (expanded ? ids : ids.slice(-MAX_VISIBLE)).toReversed();
	const hiddenCount = ids.length - visibleIds.length;

	return (
		<>
			<ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
				{visibleIds.map((id) => (
					<TaskRow key={id} id={id} />
				))}
			</ul>
			{hiddenCount > 0 && (
				<button type="button" className="btn btn-outlined self-start" onClick={() => setExpanded(true)}>
					Show {hiddenCount} more
				</button>
			)}
			{expanded && ids.length > MAX_VISIBLE && (
				<button type="button" className="btn btn-outlined self-start" onClick={() => setExpanded(false)}>
					Show less
				</button>
			)}
		</>
	);
}
