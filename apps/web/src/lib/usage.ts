import type { ApiResponse, Usage } from '@bonitashare/shared-types';

// Server-to-server during render, like lib/session.ts, so the meter is in the first HTML. Takes the
// cookie getSession returns: it carries the renewed token if the session had just expired.
// Null if the API couldn't answer — the page still works, the server still enforces the limits.
export async function getUsage(cookie: string): Promise<Usage | null> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/usage`, {
			headers: { cookie },
		});
		const { data } = (await res.json()) as ApiResponse<Usage>;
		return data;
	} catch {
		return null;
	}
}
