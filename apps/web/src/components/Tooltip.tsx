import type { ReactNode } from 'react';

type Props = {
	// The text of the plain tooltip. Give the wrapped element its own accessible name too (aria-label),
	// since the bubble is only visual.
	label: string;
	// Rich content shown instead of the plain bubble. It stays open while the pointer is over it, so it
	// can hold links and buttons. From an Astro page, pass it as `<Fragment slot="popover">`.
	popover?: ReactNode;
	children: ReactNode;
};

// CSS only, so it works without hydrating. The plain tooltip shows on hover and keyboard focus, centred
// under the element; the popover also stays open while focus is inside it, right-aligned under the element.
export default function Tooltip({ label, popover, children }: Props) {
	return (
		<span className="group/tooltip relative inline-flex">
			{children}
			{popover ? (
				// pt-2 rather than a margin, so the pointer crosses no gap moving from the trigger onto the panel.
				<div className="invisible absolute top-full right-0 z-20 pt-2 opacity-0 transition-opacity duration-150 group-focus-within/tooltip:visible group-focus-within/tooltip:opacity-100 group-hover/tooltip:visible group-hover/tooltip:opacity-100">
					<div className="min-w-48 rounded-xl bg-surface-container-high p-3 text-sm text-on-surface shadow-lg">{popover}</div>
				</div>
			) : (
				// M3 plain tooltip: inverse colours, small text, no pointer events so it never blocks a click.
				<span
					aria-hidden="true"
					className="pointer-events-none invisible absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 rounded bg-on-surface px-2 py-1 text-xs whitespace-nowrap text-surface opacity-0 transition-opacity duration-150 group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-has-[:focus-visible]/tooltip:visible group-has-[:focus-visible]/tooltip:opacity-100"
				>
					{label}
				</span>
			)}
		</span>
	);
}
