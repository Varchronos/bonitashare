type IconProps = { size?: number };

const base = {
	fill: 'none',
	stroke: 'currentColor',
	strokeWidth: 1.5,
	strokeLinecap: 'round' as const,
	strokeLinejoin: 'round' as const,
	'aria-hidden': true,
};

export function FileIcon({ size = 20 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
			<path d="M14 3v5h5" />
			<path d="M12 17V11m0 0-2.5 2.5M12 11l2.5 2.5" />
		</svg>
	);
}

export function TrashIcon({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M4 7h16" />
			<path d="M9 7V4h6v3" />
			<path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
		</svg>
	);
}

export function CheckIcon({ size = 18 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="9" />
			<path d="m8.5 12.5 2.5 2.5 5-5" />
		</svg>
	);
}

export function PauseIcon({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M8 5v14" />
			<path d="M16 5v14" />
		</svg>
	);
}

export function PlayIcon({ size = 16 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M6 4.5v15l13-7.5Z" />
		</svg>
	);
}

export function RetryIcon({ size = 14 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
			<path d="M18 3v4h-4" />
			<path d="M6 21v-4h4" />
		</svg>
	);
}
