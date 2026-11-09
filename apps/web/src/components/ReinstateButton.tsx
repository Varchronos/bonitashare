import { useState } from 'react';
import type { ApiResponse, TakedownState } from '@bonitashare/shared-types';
import Modal from './Modal';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { TakedownStatusBadge } from './TakedownTool';

async function reinstate(fileId: string): Promise<void> {
	let body: ApiResponse<null> | null;
	try {
		const res = await fetch(`/api/v1/admin/files/${encodeURIComponent(fileId)}/reinstate`, { method: 'POST' });
		body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
		if (res.ok) return;
	} catch {
		throw new Error("Couldn't reach the server. Check your connection and try again.");
	}
	throw new Error(body?.error?.message ?? "Couldn't reinstate the file. Try again.");
}

type Props = {
	fileId: string;
	filename: string;
	// Only hidden, or removed and not yet purged; see canReinstate.
	currentState: Extract<TakedownState, 'hidden' | 'removed'>;
};

// The admin reports table's button for undoing a takedown, with a confirmation step.
export default function ReinstateButton({ fileId, filename, currentState }: Props) {
	const [open, setOpen] = useState(false);
	const action = useAsyncAction({
		triggerFn: reinstate,
		// The table is rendered on the server, so reloading is what shows the file back to normal.
		onSuccess: () => location.reload(),
	});

	return (
		<>
			<button type="button" className="btn btn-sm btn-tonal" onClick={() => setOpen(true)}>
				Reinstate…
			</button>
			<Modal
				open={open}
				onClose={() => !action.isPending && setOpen(false)}
				title="Reinstate file"
				description={
					<span className="flex flex-col gap-2">
						<span className="text-on-surface [overflow-wrap:anywhere]">{filename}</span>
						<span className="flex items-center gap-2">
							Current status <TakedownStatusBadge state={currentState} />
						</span>
					</span>
				}
			>
				<p className="mb-6 text-sm">
					The takedown is lifted and the file works again for anyone with the link.
					{currentState === 'removed' && ' Its scheduled deletion is cancelled.'}
				</p>
				{action.error && (
					<p role="alert" className="mb-6 text-sm text-error">
						{action.error.message}
					</p>
				)}
				<div className="flex justify-end gap-3">
					<button type="button" className="btn btn-text" disabled={action.isPending} onClick={() => setOpen(false)}>
						Cancel
					</button>
					<button
						type="button"
						className="btn btn-filled disabled:cursor-progress disabled:opacity-70"
						disabled={action.isPending || action.isSuccess}
						onClick={() => action.trigger(fileId)}
					>
						{action.isPending || action.isSuccess ? 'Reinstating…' : 'Reinstate'}
					</button>
				</div>
			</Modal>
		</>
	);
}
