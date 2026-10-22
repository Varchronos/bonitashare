import { formatBytes, type Usage } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { liveUsage, useUsageStore, type Meter } from '../../store/usage-store';

function MeterRow({ label, meter, note }: { label: string; meter: Meter & { limit: number }; note?: string | null }) {
	const used = meter.committed + meter.inProgress;
	const pct = (bytes: number) => Math.min(100, (bytes / meter.limit) * 100);
	const committedPct = pct(meter.committed);

	return (
		<div className="usage-row">
			<div className="usage-info">
				<span>{label}</span>
				<span className="usage-figures">
					{formatBytes(used)} of {formatBytes(meter.limit)}
				</span>
			</div>
			<div
				className={`usage-bar${used >= meter.limit ? ' usage-bar-full' : ''}`}
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={meter.limit}
				aria-valuenow={Math.min(used, meter.limit)}
			>
				<div className="usage-committed" style={{ width: `${committedPct}%` }} />
				<div className="usage-in-progress" style={{ width: `${pct(used) - committedPct}%` }} />
			</div>
			{/* The date is formatted in the server's timezone on render and the browser's after hydration. */}
			{note && <span className="usage-note" suppressHydrationWarning>{note}</span>}
		</div>
	);
}

// `initial` comes from the server render, so the meter is there before the store is filled on mount.
export default function UsageMeter({ initial }: { initial: Usage | null }) {
	const usage = useUsageStore((s) => s.usage) ?? initial;
	const countedIds = useUsageStore((s) => s.countedIds);
	const files = useUploadStore((s) => s.files);

	if (!usage) return null;

	const { weekly, storage } = liveUsage(usage, files, countedIds);
	const freesAt = usage.weekly.nextFreesAt && weekly.committed > 0
		? `Space frees up from ${new Date(usage.weekly.nextFreesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
		: null;

	return (
		<div className="usage">
			<MeterRow label="Uploaded this week" meter={{ ...weekly, limit: usage.weekly.limit }} note={freesAt} />
			{/* Anonymous uploads have no storage limit; they're bounded by their fixed expiry instead. */}
			{storage.limit !== null && <MeterRow label="Storage" meter={{ ...storage, limit: storage.limit }} />}
		</div>
	);
}
