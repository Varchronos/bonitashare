import { useState, type FormEvent } from 'react';
import { REPORT_DETAILS_MAX_LENGTH, REPORT_REASON_OPTIONS, type ApiResponse, type ReportReason, type ReportRequest } from '@bonitashare/shared-types';
import { useAsyncAction } from '../hooks/useAsyncAction';
import Modal from './Modal';
import warningIcon from '../assets/warning.svg?raw';

// Codes the API answers with when the browser's user isn't a signed-in account (anonymous session,
// no session, or one that ran out while the modal was open). The modal swaps to the sign-in prompt.
const SIGN_IN_CODES = new Set(['SIGN_IN_REQUIRED', 'UNAUTHENTICATED', 'SESSION_EXPIRED']);

class ReportError extends Error {
	constructor(message: string, readonly code?: string) {
		super(message);
	}
}

async function sendReport(report: ReportRequest): Promise<void> {
	let body: ApiResponse<null> | null;
	try {
		const res = await fetch('/api/v1/reports', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(report),
		});
		body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
		if (res.ok) return;
	} catch {
		throw new ReportError("Couldn't reach the server. Check your connection and try again.");
	}
	throw new ReportError(body?.error?.message ?? "Couldn't send the report. Try again.", body?.error?.code);
}

type Props = {
	fileId: string;
	filename: string;
	// Only signed-in users can report for now; everyone else gets a login prompt in the modal.
	signedIn: boolean;
};

// The share page's Report button and the modal it opens. Not shown to the file's owner.
export default function ReportFile({ fileId, filename, signedIn }: Props) {
	const [open, setOpen] = useState(false);
	const [sent, setSent] = useState(false);
	// Starts true for anonymous visitors; also set if the API turns a report away for not being signed in.
	const [needsSignIn, setNeedsSignIn] = useState(!signedIn);
	// Bumped after a report goes through, so the next open starts on a blank form. Closing a
	// half-filled form keeps what was entered.
	const [formKey, setFormKey] = useState(0);

	function close() {
		setOpen(false);
		if (sent) {
			setSent(false);
			setFormKey((k) => k + 1);
		}
	}

	return (
		<>
			<button type="button" className="btn btn-text" onClick={() => setOpen(true)}>
				<span aria-hidden="true" className="inline-flex [&>svg]:size-[18px] [&>svg]:fill-current" dangerouslySetInnerHTML={{ __html: warningIcon }} />
				Report
			</button>

			<Modal
				open={open}
				onClose={close}
				title={needsSignIn ? 'Sign in to report this file' : sent ? 'Thanks, we got your report' : `Report ${filename}`}
				description={
					needsSignIn
						? undefined
						: sent
							? "We'll review the file and act on it if it breaks our rules. If you report it again, your new answer replaces this one."
							: "Reports are private: the person who uploaded the file isn't told who reported it."
				}
			>
				{needsSignIn ? (
					<>
						<p role="alert" className="mb-6 flex items-start gap-2 rounded-lg bg-error-container px-3 py-2 text-sm text-on-error-container">
							<span
								aria-hidden="true"
								className="mt-0.5 inline-flex shrink-0 [&>svg]:size-4 [&>svg]:fill-current"
								dangerouslySetInnerHTML={{ __html: warningIcon }}
							/>
							You need to be signed in to report a file. Log in, or create a free account, then come back to this link.
						</p>
						<div className="flex flex-wrap justify-end gap-3">
							<a className="btn btn-tonal" href="/signup">
								Sign up
							</a>
							<a className="btn btn-filled" href="/login">
								Log in
							</a>
						</div>
					</>
				) : sent ? (
					<div className="flex justify-end">
						<button type="button" className="btn btn-filled" onClick={close}>
							Done
						</button>
					</div>
				) : (
					<ReportForm key={formKey} fileId={fileId} onSent={() => setSent(true)} onSignInRequired={() => setNeedsSignIn(true)} onCancel={close} />
				)}
			</Modal>
		</>
	);
}

type FormProps = {
	fileId: string;
	onSent: () => void;
	onSignInRequired: () => void;
	onCancel: () => void;
};

function ReportForm({ fileId, onSent, onSignInRequired, onCancel }: FormProps) {
	const [reason, setReason] = useState<ReportReason | null>(null);
	const [details, setDetails] = useState('');

	const report = useAsyncAction<void, ReportError, ReportRequest>({
		triggerFn: sendReport,
		onSuccess: onSent,
		onError: (error) => {
			if (error.code && SIGN_IN_CODES.has(error.code)) onSignInRequired();
		},
	});

	function submit(event: FormEvent) {
		event.preventDefault();
		if (!reason) return;
		report.trigger({ kind: 'file', id: fileId, reason, details: details.trim() || undefined });
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-6">
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-3 text-base font-medium">What's wrong with this file?</legend>
				{REPORT_REASON_OPTIONS.map((option) => (
					<label
						key={option.value}
						className="flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 hover:bg-surface-container has-checked:bg-surface-container"
					>
						<input
							type="radio"
							name="reason"
							value={option.value}
							required
							checked={reason === option.value}
							onChange={() => setReason(option.value)}
							className="mt-1 accent-primary"
						/>
						<span>
							<span className="block text-base text-on-surface">{option.label}</span>
							<span className="block text-sm text-on-surface-variant">{option.hint}</span>
						</span>
					</label>
				))}
			</fieldset>

			<label className="flex flex-col gap-2">
				<span className="text-sm text-on-surface-variant">Details {reason === 'other' ? '' : '(optional)'}</span>
				<textarea
					name="details"
					rows={3}
					maxLength={REPORT_DETAILS_MAX_LENGTH}
					required={reason === 'other'}
					value={details}
					onChange={(e) => setDetails(e.target.value)}
					placeholder="Anything that helps us review it, like where you found the link."
					className="w-full resize-y rounded-md bg-surface-container px-4 py-3 text-base text-on-surface outline-none hover:border-on-surface focus:border-2 focus:border-primary focus:px-[15px] focus:py-[11px]"
				/>
				<span className="self-end text-xs text-on-surface-variant">
					{details.length}/{REPORT_DETAILS_MAX_LENGTH}
				</span>
			</label>

			{report.error && (
				<p role="alert" className="-my-3 text-sm text-error">
					{report.error.message}
				</p>
			)}

			<div className="flex flex-wrap items-center justify-end gap-3">
				<button type="button" className="btn btn-text" onClick={onCancel}>
					Cancel
				</button>
				<button type="submit" className="btn btn-filled disabled:cursor-progress disabled:opacity-70" disabled={report.isPending || !reason}>
					<span aria-hidden="true" className="inline-flex [&>svg]:size-[18px] [&>svg]:fill-current" dangerouslySetInnerHTML={{ __html: warningIcon }} />
					{report.isPending ? 'Sending…' : 'Send report'}
				</button>
			</div>
		</form>
	);
}
