import { useRef, useState, type KeyboardEvent } from 'react';
import { PLAN_NAMES, TIER_LIMITS, formatBytes, type Tier } from '@bonitashare/shared-types';
import warningIcon from '../assets/warning.svg?raw';

const DAY = 24 * 60 * 60;
const TIERS: Tier[] = ['anonymous', 'free', 'pro'];

// `warning`: a caveat shown in a yellow block under the body.
type Feature = { title: string; body: string; warning?: string };

// The About page's "What you get" cards for one plan. Numbers come from TIER_LIMITS, so they're the ones
// the server enforces.
function featuresFor(tier: Tier): Feature[] {
	const t = TIER_LIMITS[tier];
	const guest = tier === 'anonymous';
	const days = t.maxExpirySeconds === null ? null : Math.round(t.maxExpirySeconds / DAY);
	const renditions = t.videoRenditions.map((r) => `${r}p`).join(', ');

	return [
		guest
			? {
					title: 'No account needed',
					body: 'Start sharing the moment you land here. Sign up later and your files and history come with you.',
					// A guest is just a session cookie; without it there's no way back to the files.
					warning: 'Clearing your cookies will lose all your files.',
				}
			: {
					title: 'Your account',
					body: 'Sign in with your email on any device and your files are there, ready to share again.',
				},
		{
			title: 'Uploads',
			body: `Files up to ${formatBytes(t.maxFileBytes)} each, and ${formatBytes(t.weeklyUploadBytes)} of uploads a week. Space frees up again as the week rolls on.`,
		},
		{
			title: 'Storage',
			body:
				t.storageBytes === null
					? 'No storage limit. Guest files are bounded by their expiry instead.'
					: `${formatBytes(t.storageBytes)} of storage for everything you keep.`,
		},
		{
			title: 'How long files last',
			body:
				days === null
					? 'Files never expire. They stay until you delete them.'
					: t.customExpiry
						? `You choose when each file expires, up to ${days} days.`
						: `Files expire after ${days} days, then they're removed.`,
		},
		{
			title: 'Video that streams',
			body: t.videoRenditions.length
				? `Videos are converted to stream smoothly at ${renditions}, so people can press play instead of waiting for a download.`
				: 'Videos play from the original file. Sign up to have them converted for smooth streaming.',
		},
		{
			title: 'Previews, not just downloads',
			body: 'Images, video and audio open right on the share page, and links unfurl with a thumbnail when you paste them in a chat.',
		},
		{
			title: 'Shared with you',
			body: guest
				? 'Files people send you are listed on your home page, kept in this browser.'
				: 'Files people send you are listed on your home page, on every device you sign in on.',
		},
		{
			title: 'Undo a delete',
			body: "Deleted something by mistake? It stays restorable for a day before it's gone for good.",
		},
		{
			title: 'Light or dark',
			body: "Follows your device's theme, or pick one yourself from the top bar.",
		},
	];
}

// Tabs for each plan over the cards. Opens on the visitor's own plan. ARIA tabs: arrow keys, Home and End
// move between tabs, and only the selected tab is in the tab order.
export default function PlanFeatures({ initial = 'anonymous' }: { initial?: Tier }) {
	const [tier, setTier] = useState<Tier>(initial);
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);

	function onKeyDown(e: KeyboardEvent) {
		const i = TIERS.indexOf(tier);
		const next =
			e.key === 'ArrowRight' ? (i + 1) % TIERS.length
			: e.key === 'ArrowLeft' ? (i - 1 + TIERS.length) % TIERS.length
			: e.key === 'Home' ? 0
			: e.key === 'End' ? TIERS.length - 1
			: null;
		if (next === null) return;
		e.preventDefault();
		setTier(TIERS[next]);
		tabs.current[next]?.focus();
	}

	return (
		<div className="flex flex-col gap-6">
			<div role="tablist" aria-label="Plans" className="flex gap-1 self-start rounded-full bg-surface-container p-1" onKeyDown={onKeyDown}>
				{TIERS.map((t, i) => (
					<button
						key={t}
						ref={(el) => {
							tabs.current[i] = el;
						}}
						type="button"
						role="tab"
						id={`plan-tab-${t}`}
						aria-selected={t === tier}
						aria-controls="plan-panel"
						tabIndex={t === tier ? 0 : -1}
						onClick={() => setTier(t)}
						className="state-layer inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-5 text-sm font-medium text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary aria-selected:bg-secondary-container aria-selected:text-on-secondary-container"
					>
						{PLAN_NAMES[t]}
						{t === 'pro' && <span className="text-xs font-normal opacity-70">Soon</span>}
					</button>
				))}
			</div>

			<div
				role="tabpanel"
				id="plan-panel"
				aria-labelledby={`plan-tab-${tier}`}
				className="grid grid-cols-3 gap-4 max-[800px]:grid-cols-1"
			>
				{featuresFor(tier).map((f) => (
					<article key={f.title} className="card p-6">
						<h3 className="mb-2 text-base font-medium">{f.title}</h3>
						<p className="text-sm leading-relaxed text-on-surface-variant">{f.body}</p>
						{f.warning && (
							<p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-container px-3 py-2 text-sm text-on-warning-container">
								<span
									aria-hidden="true"
									className="mt-0.5 inline-flex shrink-0 [&>svg]:size-4 [&>svg]:fill-current"
									dangerouslySetInnerHTML={{ __html: warningIcon }}
								/>
								{f.warning}
							</p>
						)}
					</article>
				))}
			</div>
		</div>
	);
}
