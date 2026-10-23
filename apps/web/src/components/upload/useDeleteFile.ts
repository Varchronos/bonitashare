import { useState } from 'react';
import { deleteFile } from '../../lib/files';
import { refreshUsage } from '../../store/usage-store';

// Shared by the finished-upload rows in TaskList and UserFiles: asks first, then deletes on the server
// and hands the row back to its list to drop. The usage meter refetches, since storage just went down.
export function useDeleteFile(id: string | null, filename: string, onDeleted: () => void) {
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function remove() {
		if (!id || deleting || !window.confirm(`Delete "${filename}"? Its link stops working now; you can restore it from Recently deleted for a day.`)) return;
		setDeleting(true);
		setError(null);
		try {
			await deleteFile(id);
			onDeleted();
			refreshUsage();
		} catch (err) {
			setError((err as Error).message);
			setDeleting(false);
		}
	}

	return { remove, deleting, error };
}
