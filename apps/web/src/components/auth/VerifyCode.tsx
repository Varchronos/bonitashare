import { useEffect, useState, type FormEvent } from 'react';
import type { ApiResponse, OtpSent, SignedUp } from '@bonitashare/shared-types';
import { clearPendingSignup, loadPendingSignup, savePendingSignup } from '../../lib/pending-signup';
import { useAsyncAction } from '../../hooks/useAsyncAction';

// Codes after which there's nothing left to retry: the signup has to start over from /signup.
const START_OVER = new Set(['OTP_TOO_MANY_ATTEMPTS', 'OTP_NOT_FOUND', 'EMAIL_TAKEN']);
// Matches the API's OTP_RESEND_COOLDOWN_MS, for when a 429 comes back without a resendAfter.
const FALLBACK_COOLDOWN_MS = 60_000;

// Carries the API's error code, so callers can tell a dead signup from a mistyped code.
class AuthError extends Error {
	constructor(message: string, readonly code: string | null) {
		super(message);
	}
}

// Resolves with the data, or throws an AuthError: the API's own, or a network one with no code.
async function post<T>(path: string, body: object): Promise<T> {
	let json: ApiResponse<T>;
	try {
		const res = await fetch(`/api/v1/auth/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		json = (await res.json()) as ApiResponse<T>;
	} catch {
		throw new AuthError("Couldn't reach the server. Check your connection and try again.", null);
	}
	if (json.error) throw new AuthError(json.error.message, json.error.code);
	return json.data;
}

const formatWait = (ms: number) => {
	const s = Math.ceil(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Step two of signup. The pending signup comes from sessionStorage (set by AuthForm), so this only
// renders once hydrated; without one there's nothing to verify and it points back to /signup.
export default function VerifyCode() {
	const [pending, setPending] = useState<OtpSent | null | undefined>(undefined);
	const [code, setCode] = useState('');
	const [now, setNow] = useState(() => Date.now());

	const verify = useAsyncAction<SignedUp, AuthError, { email: string; code: string }>({
		triggerFn: (body) => post('signup/verify', body),
		onSuccess: () => {
			clearPendingSignup();
			location.assign('/account');
		},
		onError: (err) => {
			if (err.code !== 'ALREADY_SIGNED_UP') return;
			clearPendingSignup();
			location.assign('/account');
		},
	});

	const resend = useAsyncAction<OtpSent, AuthError, { email: string }>({
		triggerFn: (body) => post('signup/resend', body),
		onSuccess: (sent) => {
			savePendingSignup(sent);
			setPending(sent);
			setNow(Date.now());
			setCode('');
		},
		onError: (err) => {
			// The API says wait without saying how long: restart the countdown from the usual cooldown.
			if (err.code !== 'OTP_COOLDOWN') return;
			setPending((prev) => {
				if (!prev) return prev;
				const next = { ...prev, resendAfter: new Date(Date.now() + FALLBACK_COOLDOWN_MS).toISOString() };
				savePendingSignup(next);
				return next;
			});
			setNow(Date.now());
		},
	});

	useEffect(() => setPending(loadPendingSignup()), []);

	const resendAt = pending ? Date.parse(pending.resendAfter) : 0;
	const waitMs = Math.max(0, resendAt - now);

	// Ticks only while the cooldown is running.
	useEffect(() => {
		if (waitMs <= 0) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [waitMs > 0]);

	if (pending === undefined) return null;

	if (!pending) {
		return (
			<section className="mx-auto flex w-full max-w-page justify-center px-4 py-16">
				<div className="w-full max-w-100 rounded-[28px] bg-surface-container-low px-6 py-8 sm:px-8">
					<h1 className="mb-2 text-headline">Nothing to verify</h1>
					<p className="mb-8 text-sm text-on-surface-variant">There's no signup waiting on a code in this tab.</p>
					<a href="/signup" className="btn btn-filled w-full">Sign up</a>
				</div>
			</section>
		);
	}

	const email = pending.email;

	function submit(event: FormEvent) {
		event.preventDefault();
		verify.trigger({ email, code });
	}

	return (
		<section className="mx-auto flex w-full max-w-page justify-center px-4 py-16">
			<div className="w-full max-w-100 rounded-[28px] bg-surface-container-low px-6 py-8 sm:px-8">
				<h1 className="mb-2 text-headline">Check your email</h1>
				<p className="mb-10 text-sm text-on-surface-variant">
					We sent a 6-digit code to <span className="font-medium text-on-surface">{email}</span>. It expires in 10 minutes.
				</p>

				<form onSubmit={submit} className="flex flex-col gap-8">
					<label className="relative block">
						<input
							name="code"
							type="text"
							inputMode="numeric"
							autoComplete="one-time-code"
							pattern="\d{6}"
							maxLength={6}
							required
							autoFocus
							placeholder=" "
							value={code}
							onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
							className="peer h-12 w-full rounded-md bg-surface-container px-4 text-base text-on-surface outline-none hover:border-on-surface focus:border-2 focus:border-primary focus:px-[15px] tracking-[0.3em]"
						/>
						<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 px-1 text-base text-on-surface-variant transition-all peer-focus:-top-3 peer-focus:left-0 peer-focus:text-xs peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-xs">Verification code</span>
					</label>

					{verify.error && verify.error.code !== 'ALREADY_SIGNED_UP' && (
						<p role="alert" className="-my-4 text-sm text-error">
							{verify.error.message}
							{START_OVER.has(verify.error.code ?? '') && (
								<>
									{' '}
									<a href="/signup" className="underline" onClick={clearPendingSignup}>Start again</a>
								</>
							)}
						</p>
					)}

					<button type="submit" className="btn btn-filled mt-2 w-full" disabled={verify.isPending || code.length !== 6}>
						{verify.isPending ? 'Verifying…' : 'Verify'}
					</button>
				</form>

				<p className="mt-6 text-center text-sm text-on-surface-variant">
					Didn't get it?{' '}
					<button type="button" className="btn btn-text btn-sm" disabled={waitMs > 0 || resend.isPending} onClick={() => resend.trigger({ email })}>
						{waitMs > 0 ? `Resend in ${formatWait(waitMs)}` : resend.isPending ? 'Sending…' : 'Resend code'}
					</button>
				</p>
				{resend.error && (
					<p role="alert" className="mb-2 text-center text-sm text-error">
						{resend.error.message}
						{START_OVER.has(resend.error.code ?? '') && (
							<>
								{' '}
								<a href="/signup" className="underline" onClick={clearPendingSignup}>Start again</a>
							</>
						)}
					</p>
				)}
				{resend.isSuccess && (
					<p role="status" className="mb-2 text-center text-sm text-on-surface-variant">
						A new code is on its way. The old one no longer works.
					</p>
				)}
				<p className="text-center text-sm text-on-surface-variant">
					Wrong address?{' '}
					<a href="/signup" className="btn btn-text btn-sm" onClick={clearPendingSignup}>Change email</a>
				</p>
			</div>
		</section>
	);
}
