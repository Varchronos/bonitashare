import { useEffect, useId, useRef, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export type SortOption<K extends string> = {
	value: K;
	label: string;
	// Labels for ascending then descending, e.g. ['A → Z', 'Z → A']. Leave out for a sort with no
	// direction (grouping by type), and the direction section is hidden while it's selected.
	directions?: [asc: string, desc: string];
	// Which way it starts when picked. Defaults to ascending.
	defaultDir?: SortDirection;
};

export type SortValue<K extends string> = { key: K; dir: SortDirection };

type Props<K extends string> = {
	options: SortOption<K>[];
	value: SortValue<K>;
	onChange: (value: SortValue<K>) => void;
	// The list's own order. Any other sort highlights the button and adds an ✕ that resets to it.
	defaultValue?: SortValue<K>;
};

// A sort icon button that opens a menu: which field to sort by, then which way. Generic over the keys,
// so any list can use it with its own options.
export default function SortMenu<K extends string>({ options, value, onChange, defaultValue }: Props<K>) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const current = options.find((o) => o.value === value.key);
	const active = defaultValue !== undefined && (value.key !== defaultValue.key || value.dir !== defaultValue.dir);
	// e.g. "Size · Largest first", or just "File type" for a sort with no direction.
	const currentLabel = current
		? current.directions
			? `${current.label} · ${current.directions[value.dir === 'asc' ? 0 : 1]}`
			: current.label
		: '';

	// Closes on a click outside or Escape, the way native menus do.
	useEffect(() => {
		if (!open) return;
		const onPointer = (e: PointerEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		document.addEventListener('pointerdown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div ref={rootRef} className="relative">
			{/* Active: a tonal pill holding the sort button (icon, plus the sort's name from sm up) and an ✕. */}
			<div className={`flex items-center rounded-full ${active || open ? 'bg-secondary-container text-on-secondary-container' : ''}`}>
				<button
					type="button"
					className={
						active
							? 'state-layer inline-flex h-10 cursor-pointer items-center gap-2 rounded-full pr-1 pl-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary sm:pr-2'
							: `icon-btn ${open ? 'text-on-secondary-container' : ''}`
					}
					aria-label={`Sort: ${currentLabel}`}
					title={`Sort: ${currentLabel}`}
					aria-haspopup="menu"
					aria-expanded={open}
					aria-controls={menuId}
					onClick={() => setOpen((o) => !o)}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M7 4v16m0 0-3-3m3 3 3-3" />
						<path d="M17 20V4m0 0-3 3m3-3 3 3" />
					</svg>
					{active && <span className="hidden whitespace-nowrap sm:inline">{currentLabel}</span>}
				</button>
				{active && (
					<button
						type="button"
						className="mr-1 icon-btn icon-btn-sm text-on-secondary-container"
						aria-label="Clear sort"
						title="Clear sort"
						onClick={() => {
							onChange(defaultValue);
							setOpen(false);
						}}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
							<path d="M6 6l12 12M18 6 6 18" />
						</svg>
					</button>
				)}
			</div>
			{open && (
				<div id={menuId} role="menu" aria-label="Sort by" className="absolute top-full right-0 z-20 mt-1 min-w-52 rounded-xl bg-surface-container-high py-2 text-sm text-on-surface shadow-lg">
					<p className="px-4 pt-1 pb-2 text-xs font-medium text-on-surface-variant">Sort by</p>
					{options.map((o) => (
						<MenuItem
							key={o.value}
							checked={o.value === value.key}
							label={o.label}
							onSelect={() => {
								onChange({ key: o.value, dir: o.value === value.key ? value.dir : (o.defaultDir ?? 'asc') });
								// Stays open for a field with directions, so the next pick can be the direction.
								if (!o.directions) setOpen(false);
							}}
						/>
					))}
					{current?.directions && (
						<>
							<div role="separator" className="my-2 h-px bg-outline-variant" />
							{(['asc', 'desc'] as const).map((dir, i) => (
								<MenuItem
									key={dir}
									checked={value.dir === dir}
									label={current.directions![i]}
									onSelect={() => {
										onChange({ key: value.key, dir });
										setOpen(false);
									}}
								/>
							))}
						</>
					)}
				</div>
			)}
		</div>
	);
}

function MenuItem({ checked, label, onSelect }: { checked: boolean; label: string; onSelect: () => void }) {
	return (
		<button
			type="button"
			role="menuitemradio"
			aria-checked={checked}
			className="state-layer flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
			onClick={onSelect}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={checked ? 'text-primary' : 'invisible'}>
				<path d="m5 12.5 4.5 4.5L19 7.5" />
			</svg>
			{label}
		</button>
	);
}
