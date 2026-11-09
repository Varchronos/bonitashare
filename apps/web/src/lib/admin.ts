import type { AdminReportPage, ApiResponse } from '@bonitashare/shared-types';

// Server-to-server during render, like lib/files.ts. Passes the page's own query string (reason,
// minReports, sort, page) straight through; the API validates it.
export async function getReportedFiles(cookie: string, query: URLSearchParams): Promise<ApiResponse<AdminReportPage>> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/admin/reports?${query}`, {
			headers: { cookie },
		});
		return (await res.json()) as ApiResponse<AdminReportPage>;
	} catch {
		return { data: null, error: { code: 'UNREACHABLE', message: "Couldn't reach the API." } };
	}
}
