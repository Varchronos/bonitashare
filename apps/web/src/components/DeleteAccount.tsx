import { useState, type FormEvent } from 'react';
import type { ApiResponse } from '@bonitashare/shared-types';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useUploadStore } from '../store/file-store';

async function deleteAccount(password: string): Promise<void> {
	let body: ApiResponse<null> | null;
	try {
		const res = await fetch('/api/v1/account', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password }),
		});
		body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
		if (res.ok) return;
	} catch {
		throw new Error("Couldn't reach the server. Check your connection and try again.");
	}
	throw new Error(body?.error?.message ?? "Couldn't delete your account. Try again.");
}

// The account page's danger zone (beta). Asks for the password again, then deletes the account and
// everything uploaded to it straight away; there's no undo yet.
export default function DeleteAccount() {
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState('');

	const nuke = useAsyncAction({
		triggerFn: deleteAccount,
		onSuccess: async () => {
			// Unfinished uploads kept in this browser belonged to the account and can't resume now.
			await Promise.resolve(useUploadStore.getState().clear()).catch(() => {});
			location.assign('/');
		},
	});

	function submit(event: FormEvent) {
		event.preventDefault();
		nuke.trigger(password);
	}

	return (
		<section className="rounded-[28px] bg-surface-container px-6 py-6 sm:px-8">
			<div className="mb-2 flex items-center gap-2">
				<h2 className="text-title text-error">Delete account</h2>
				<span className="rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-black">Beta</span>
			</div>
			<p className="mb-6 text-sm text-on-surface-variant">
				Deletes your account and every file you've uploaded, with their links, thumbnails and videos. This happens right away and
				can't be undone.
			</p>

			{!open ? (
				<button type="button" className="btn bg-error-container text-on-error-container not-disabled:hover:shadow-sm" onClick={() => setOpen(true)}>
					Delete account…
				</button>
			) : (
				<form onSubmit={submit} className="flex max-w-100 flex-col gap-6">
					<label className="relative block">
						<input
							name="password"
							type="password"
							autoComplete="current-password"
							required
							autoFocus
							placeholder=" "
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="peer h-12 w-full rounded-md bg-surface-container px-4 text-base text-on-surface outline-none hover:border-on-surface focus:border-2 focus:border-error focus:px-[15px]"
						/>
						<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 px-1 text-base text-on-surface-variant transition-all peer-focus:-top-3 peer-focus:left-0 peer-focus:text-xs peer-focus:text-error peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs">
							Your password
						</span>
					</label>

					{nuke.error && (
						<p role="alert" className="-my-3 text-sm text-error">
							{nuke.error.message}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-3">
						<button
							type="submit"
							className="btn bg-error-container text-on-error-container not-disabled:hover:shadow-sm disabled:cursor-progress disabled:opacity-70"
							disabled={nuke.isPending || !password}
						>
							{nuke.isPending ? 'Deleting…' : 'Delete everything'}
						</button>
						<button
							type="button"
							className="btn btn-text"
							disabled={nuke.isPending}
							onClick={() => {
								setOpen(false);
								setPassword('');
							}}
						>
							Cancel
						</button>
					</div>
				</form>
			)}
		</section>
	);
}
