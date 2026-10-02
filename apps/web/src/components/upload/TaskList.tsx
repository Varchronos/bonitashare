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

	// Newest-first via CSS (column-reverse), so "visible" is the tail of
	// insertion order — the most recently added uploads.
	const visibleIds = expanded ? ids : ids.slice(-MAX_VISIBLE);
	const hiddenCount = ids.length - visibleIds.length;

	return (
		<>
			<ul className="task-list">
				{visibleIds.map((id) => (
					<TaskRow key={id} id={id} />
				))}
			</ul>
			{hiddenCount > 0 && (
				<button type="button" className="tasks-show-more" onClick={() => setExpanded(true)}>
					Show {hiddenCount} more
				</button>
			)}
			{expanded && ids.length > MAX_VISIBLE && (
				<button type="button" className="tasks-show-more" onClick={() => setExpanded(false)}>
					Show less
				</button>
			)}
		</>
	);
}
