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

export function RestoreIcon({ size = 18, className }: IconProps & { className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
			<path d="M4 12a8 8 0 1 0 2.3-5.6" />
			<path d="M4 4v4h4" />
		</svg>
	);
}

export function SearchIcon({ size = 20 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<circle cx="11" cy="11" r="6.5" />
			<path d="m20 20-4.4-4.4" />
		</svg>
	);
}

export function GridIcon({ size = 20 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
			<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
			<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
			<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
		</svg>
	);
}

export function ListIcon({ size = 20 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M9 6h11M9 12h11M9 18h11" />
			<path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth={2.5} />
		</svg>
	);
}

export function CloseIcon({ size = 18 }: IconProps) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" {...base}>
			<path d="M6 6l12 12M18 6 6 18" />
		</svg>
	);
}
