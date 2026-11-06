import { useState, type FormEvent } from 'react';
import {
	REPORT_REASON_OPTIONS,
	TAKEDOWN_PURGE_OPTIONS,
	TAKEDOWN_SOURCE_OPTIONS,
	TAKEDOWN_STATE_OPTIONS,
	type ManualTakedownSource,
	type ReportReason,
	type TakedownPurge,
	type ApiResponse,
	type FileTakedown,
	type TakedownRequest,
	type TakedownState,
} from '@bonitashare/shared-types';
import Modal from './Modal';
import { useAsyncAction } from '../hooks/useAsyncAction';

async function sendTakedown({ fileId, request }: { fileId: string; request: TakedownRequest }): Promise<FileTakedown> {
	let body: ApiResponse<FileTakedown> | null;
	try {
		const res = await fetch(`/api/v1/admin/files/${encodeURIComponent(fileId)}/takedown`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request),
		});
		body = (await res.json().catch(() => null)) as ApiResponse<FileTakedown> | null;
		if (res.ok && body?.data) return body.data;
	} catch {
		throw new Error("Couldn't reach the server. Check your connection and try again.");
	}
	throw new Error(body?.error?.message ?? "Couldn't apply the takedown. Try again.");
}

export const takedownStateLabel = (value: TakedownState | null) =>
	value ? TAKEDOWN_STATE_OPTIONS.find((o) => o.value === value)!.label : 'Live';

// The file's takedown status as a coloured pill: green while live, red once taken down.
export function TakedownStatusBadge({ state }: { state: TakedownState | null }) {
	return (
		<span
			className={`rounded-full px-3 py-1 text-xs font-medium ${state ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}
		>
			{takedownStateLabel(state)}
		</span>
	);
}

type Props = {
	fileId: string;
	filename: string;
	// The file's takedown as it stands; null while it's live.
	currentState?: TakedownState | null;
	// Preselected reason, e.g. the one most reports gave.
	defaultReason?: ReportReason | null;
};

// The takedown form itself, shared by the share page's card (TakedownTool) and the reports table's
// pop-up (TakedownButton). Admins only; the API checks the role again.
export function TakedownForm({ fileId, filename, currentState = null, defaultReason = null }: Props) {
	const [state, setState] = useState<TakedownState>('hidden');
	const [reason, setReason] = useState<ReportReason | ''>(defaultReason ?? '');
	const [source, setSource] = useState<ManualTakedownSource>('admin');
	const [purge, setPurge] = useState<TakedownPurge>('30d');
	const [confirming, setConfirming] = useState(false);

	const stateLabel = takedownStateLabel;
	const reasonLabel = REPORT_REASON_OPTIONS.find((o) => o.value === reason)?.label;
	const sourceLabel = TAKEDOWN_SOURCE_OPTIONS.find((o) => o.value === source)!.label;
	const purgeLabel = TAKEDOWN_PURGE_OPTIONS.find((o) => o.value === purge)!.label;

	const ready = Boolean(reason);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (!ready) return;
		setConfirming(true);
	}

	const takedown = useAsyncAction({
		triggerFn: sendTakedown,
		// The page is rendered on the server from the file's takedown, so reloading is what shows the new state
		// everywhere (status badge, notices, the reports table's row).
		onSuccess: () => location.reload(),
	});

	function confirm() {
		takedown.trigger({
			fileId,
			request: { state, reason: reason as ReportReason, source, ...(state === 'removed' ? { purge } : {}) },
		});
	}

	return (
		<>
			<form onSubmit={submit} className="flex flex-col gap-6">
				<fieldset>
					<legend className="mb-2 text-sm font-medium">Takedown status</legend>
					<div className="grid gap-2 sm:grid-cols-3">
						{TAKEDOWN_STATE_OPTIONS.map((option) => (
							<label
								key={option.value}
								className="flex cursor-pointer flex-col gap-1 rounded-2xl border border-outline-variant px-4 py-3 hover:bg-surface-container has-checked:border-error has-checked:bg-error-container/40"
							>
								<span className="flex items-center gap-2">
									<input
										type="radio"
										name="state"
										value={option.value}
										checked={state === option.value}
										onChange={() => setState(option.value)}
										className="accent-error"
									/>
									<span className="font-medium">{option.label}</span>
								</span>
								<span className="text-xs text-on-surface-variant">{option.hint}</span>
							</label>
						))}
					</div>
				</fieldset>

				<div className="grid gap-4 sm:grid-cols-2">
					<label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
						Reason
						<select
							name="reason"
							required
							value={reason}
							onChange={(e) => setReason(e.target.value as ReportReason)}
							className="h-10 w-full rounded-md bg-surface-container px-3 text-base font-normal text-on-surface outline-none focus:ring-2 focus:ring-primary"
						>
							<option value="" disabled>
								Choose a reason
							</option>
							{REPORT_REASON_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</label>

					<fieldset className="min-w-0">
						<legend className="mb-1.5 text-sm font-medium">Source</legend>
						<div className="flex h-10 overflow-hidden rounded-full border border-outline-variant">
							{TAKEDOWN_SOURCE_OPTIONS.map((option) => (
								<label
									key={option.value}
									className="flex flex-1 cursor-pointer items-center justify-center border-l border-outline-variant px-2 text-center text-xs first:border-l-0 hover:bg-surface-container has-checked:bg-secondary-container has-checked:text-on-secondary-container has-focus-visible:ring-2 has-focus-visible:ring-primary has-focus-visible:ring-inset"
								>
									<input
										type="radio"
										name="source"
										value={option.value}
										checked={source === option.value}
										onChange={() => setSource(option.value)}
										className="sr-only"
									/>
									{option.label}
								</label>
							))}
						</div>
					</fieldset>
				</div>

				<fieldset disabled={state !== 'removed'} className="group/purge">
					<legend className="mb-1.5 text-sm font-medium group-disabled/purge:text-on-surface-variant">Purge original</legend>
					<div className="grid gap-2 sm:grid-cols-2">
						{TAKEDOWN_PURGE_OPTIONS.map((option) => (
							<label
								key={option.value}
								className={`flex items-start gap-2 rounded-2xl border border-outline-variant px-4 py-3 ${state === 'removed' ? 'cursor-pointer hover:bg-surface-container has-checked:border-error has-checked:bg-error-container/40' : 'cursor-not-allowed opacity-50'}`}
							>
								<input
									type="radio"
									name="purge"
									value={option.value}
									checked={purge === option.value}
									onChange={() => setPurge(option.value)}
									className="mt-1 accent-error"
								/>
								<span>
									<span className="block font-medium">{option.label}</span>
									<span className="block text-xs text-on-surface-variant">{option.hint}</span>
								</span>
							</label>
						))}
					</div>
					{state !== 'removed' && <p className="mt-1.5 text-xs text-on-surface-variant">Only removed files are purged.</p>}
				</fieldset>


				<div className="flex justify-end">
					<button type="submit" disabled={!ready} className="btn bg-error text-surface not-disabled:hover:shadow-sm disabled:opacity-50">
						Apply takedown…
					</button>
				</div>
			</form>

			<Modal
				open={confirming}
				onClose={() => setConfirming(false)}
				title={`${stateLabel(state)}: ${filename}`}
				description="Check the details before applying."
			>
				<dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
					<dt className="text-on-surface-variant">File ID</dt>
					<dd className="font-mono">{fileId}</dd>
					<dt className="text-on-surface-variant">Status</dt>
					<dd>
						{stateLabel(currentState)} → <span className="font-medium">{stateLabel(state)}</span>
					</dd>
					<dt className="text-on-surface-variant">Reason</dt>
					<dd>{reasonLabel}</dd>
					<dt className="text-on-surface-variant">Source</dt>
					<dd>{sourceLabel}</dd>
					{state === 'removed' && (
						<>
							<dt className="text-on-surface-variant">Purge original</dt>
							<dd>{purgeLabel}</dd>
						</>
					)}
				</dl>
				{state === 'removed' && purge === 'immediate' && (
					<p className="mb-6 rounded-lg bg-error-container px-3 py-2 text-sm text-on-error-container">
						The original will be deleted at the next sweep. This can't be undone.
					</p>
				)}
				{takedown.error && (
					<p role="alert" className="mb-6 text-sm text-error">
						{takedown.error.message}
					</p>
				)}
				<div className="flex justify-end gap-3">
					<button type="button" className="btn btn-text" disabled={takedown.isPending} onClick={() => setConfirming(false)}>
						Cancel
					</button>
					<button
						type="button"
						className="btn bg-error text-surface not-disabled:hover:shadow-sm disabled:cursor-progress disabled:opacity-70"
						disabled={takedown.isPending || takedown.isSuccess}
						onClick={confirm}
					>
						{takedown.isPending || takedown.isSuccess ? 'Applying…' : 'Confirm'}
					</button>
				</div>
			</Modal>
		</>
	);
}

// Admins only, at the bottom of a share page.
export default function TakedownTool(props: Props) {
	return (
		<section aria-labelledby="takedown-heading" className="mt-12 rounded-[28px] bg-surface-container-low px-6 py-6 sm:px-8">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="takedown-heading" className="text-title">
						Takedown
					</h2>
					<p className="text-sm text-on-surface-variant">Only admins see this.</p>
				</div>
				<p className="flex items-center gap-2 text-sm">
					<span className="text-on-surface-variant">Status</span>
					<TakedownStatusBadge state={props.currentState ?? null} />
				</p>
			</div>
			<TakedownForm {...props} />
		</section>
	);
}
