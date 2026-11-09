import { useState } from 'react';
import type { ReportReason, TakedownState } from '@bonitashare/shared-types';
import Modal from './Modal';
import { TakedownForm, TakedownStatusBadge } from './TakedownTool';

type Props = {
	fileId: string;
	filename: string;
	currentState: TakedownState | null;
	defaultReason?: ReportReason | null;
};

// The admin reports table's per-file button: opens the same takedown form as the share page, in a
// pop-up. Works for files the admin couldn't open by link (private ones, later on).
export default function TakedownButton({ fileId, filename, currentState, defaultReason }: Props) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button type="button" className="btn btn-sm bg-error-container text-on-error-container not-disabled:hover:shadow-sm" onClick={() => setOpen(true)}>
				Takedown…
			</button>
			<Modal
				open={open}
				onClose={() => setOpen(false)}
				size="lg"
				title="Takedown"
				description={
					<span className="flex flex-col gap-2">
						<span className="text-on-surface [overflow-wrap:anywhere]">{filename}</span>
						<span className="flex items-center gap-2">
							Current status <TakedownStatusBadge state={currentState} />
						</span>
					</span>
				}
			>
				{/* Only mounted while open, so each opening starts from the defaults. */}
				{open && <TakedownForm fileId={fileId} filename={filename} currentState={currentState} defaultReason={defaultReason} />}
			</Modal>
		</>
	);
}
