import { useEffect, useState } from 'react';

// useState that this browser remembers between visits, for view preferences. Starts from `initial`
// and reads storage after mounting, so the server render and the first client render match.
// Storage can be missing or throw (private windows, blocked site data); then it's plain useState.
export function useStoredState<T>(key: string, initial: T, isValid: (v: unknown) => v is T) {
	const [value, setValue] = useState(initial);

	useEffect(() => {
		try {
			const raw = localStorage.getItem(key);
			if (raw === null) return;
			const parsed: unknown = JSON.parse(raw);
			if (isValid(parsed)) setValue(parsed);
		} catch {
			// Unreadable or not ours: keep the default.
		}
	}, [key]);

	const set = (next: T) => {
		setValue(next);
		try {
			localStorage.setItem(key, JSON.stringify(next));
		} catch {
			// Not remembered this time; the choice still applies on this page.
		}
	};

	return [value, set] as const;
}
