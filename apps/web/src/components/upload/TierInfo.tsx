import { PLAN_NAMES, TIER_LIMITS, formatBytes, type Tier, type Usage } from '@bonitashare/shared-types';
// ?raw: the SVG's markup inlined, so it takes currentColor (an Astro SVG component can't be used in React).
import arrowRight from '../../assets/arrow_right.svg?raw';
import checkmark from '../../assets/checkmark.svg?raw';
import warning from '../../assets/warning.svg?raw';
import { useUsageStore } from '../../store/usage-store';

const DAY = 24 * 60 * 60;

// What a tier offers, one line each, from TIER_LIMITS so the card can't drift from what the server enforces.
// `limited` marks a line that's a restriction rather than a perk (a fixed expiry, no video streaming).
function perks(tier: Tier): { text: string; limited: boolean }[] {
	const t = TIER_LIMITS[tier];
	const days = t.maxExpirySeconds === null ? null : Math.round(t.maxExpirySeconds / DAY);
	return [
		{ text: `Upto ${formatBytes(t.maxFileBytes)} per file`, limited: false },
		{ text: `${formatBytes(t.weeklyUploadBytes)} of uploads a week`, limited: false },
		{ text: t.storageBytes === null ? 'No storage limit' : `${formatBytes(t.storageBytes)} of storage`, limited: false },
		days === null
			? { text: 'Files never expire', limited: false }
			: t.customExpiry
				? { text: `Choose an expiry, up to ${days} days`, limited: false }
				: { text: `Files expire after ${days} days`, limited: true },
		t.videoRenditions.length
			? { text: `Video streaming at ${t.videoRenditions.map((r) => `${r}p`).join(', ')}`, limited: false }
			: { text: 'No video streaming', limited: true },
	];
}

// The user's plan and what it includes, under the usage meter. Wide screens only: phones get just the
// meter. Reads the tier from the same usage as the meter.
export default function TierInfo({ initial }: { initial: Usage | null }) {
	const tier = (useUsageStore((s) => s.usage) ?? initial)?.tier;
	if (!tier) return null;

	return (
		<div className="card hidden flex-col gap-3 p-4 md:flex">
			<div className="flex items-center justify-between gap-3">
				<span className="text-sm font-medium text-on-surface">Your plan</span>
				<span className="rounded-full bg-secondary-container px-3 py-1 text-xs font-medium text-on-secondary-container">
					{PLAN_NAMES[tier]}
				</span>
			</div>
			<ul className="flex flex-col gap-1.5 text-sm text-on-surface-variant">
				{perks(tier).map(({ text, limited }) => (
					<li key={text} className="flex items-start gap-2">
						{/* The tick is drawn with a stroke and the warning with a fill, so only the warning gets fill-current. */}
						<span
							aria-hidden="true"
							className={`mt-0.5 inline-flex shrink-0 text-primary [&>svg]:size-4 ${limited ? '[&>svg]:fill-current' : ''}`}
							dangerouslySetInnerHTML={{ __html: limited ? warning : checkmark }}
						/>
						{text}
					</li>
				))}
			</ul>
			{/* Guests can get more by signing up; there's no way to buy Pro yet. */}
			{tier === 'anonymous' && (
				<a
					href="/signup"
					className="group inline-flex items-center gap-1 self-end rounded text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
				>
					Sign up for more
					<span
						aria-hidden="true"
						className="inline-flex transition-transform duration-150 group-hover:translate-x-0.5 [&>svg]:size-3.5 [&>svg]:fill-current"
						dangerouslySetInnerHTML={{ __html: arrowRight }}
					/>
				</a>
			)}
		</div>
	);
}
