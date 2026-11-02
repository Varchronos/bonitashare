import { deleteFile } from '../../lib/files';
import { refreshUsage } from '../../store/usage-store';
import { useAsyncAction } from '../../hooks/useAsyncAction';

// Shared by the finished-upload rows in TaskList and UserFiles: asks first, then deletes on the server
// and hands the row back to its list to drop. The usage meter refetches, since storage just went down.
export function useDeleteFile(id: string | null, filename: string, onDeleted: () => void) {
	const action = useAsyncAction({
		triggerFn: (fileId: string) => deleteFile(fileId),
		onSuccess: () => {
			onDeleted();
			refreshUsage();
		},
	});

	function remove() {
		if (!id || action.isPending || !window.confirm(`Delete "${filename}"? Its link stops working now; you can restore it from Recently deleted for a day.`)) return;
		action.trigger(id);
	}

	return { remove, deleting: action.isPending, error: action.error?.message ?? null };
}
