import type { OtpSent } from '@bonitashare/shared-types';

// The signup waiting on its code, handed from /signup to /verify. sessionStorage rather than the URL so
// the address stays out of history and server logs; per tab, which is fine for a few minutes' flow.
// The API holds the real state: losing this only means typing the email again.
const KEY = 'bonitashare-pending-signup';

export function savePendingSignup(sent: OtpSent) {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(sent));
	} catch {}
}

export function loadPendingSignup(): OtpSent | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as OtpSent) : null;
	} catch {
		return null;
	}
}

export function clearPendingSignup() {
	try {
		sessionStorage.removeItem(KEY);
	} catch {}
}
