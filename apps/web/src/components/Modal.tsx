import { useEffect, useId, useRef, type ReactNode } from 'react';
import xmarkIcon from '../assets/xmark.svg?raw';

type Props = {
	open: boolean;
	// Called for every way the user can dismiss it: Esc, the close button, or a click on the backdrop.
	onClose: () => void;
	title: ReactNode;
	// Under the title, before the content.
	description?: ReactNode;
	children: ReactNode;
	// 'lg' for dialogs holding a full form.
	size?: 'md' | 'lg';
};

// A dialog over the page, built on the native <dialog> opened with showModal(): the browser keeps focus
// inside it, makes the page behind inert, and hands focus back to whatever opened it on close. `open`
// is the only source of truth, so the dialog's own closing (Esc) is reported through onClose and the
// parent decides.
export default function Modal({ open, onClose, title, description, children, size = 'md' }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const descriptionId = useId();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	// The page behind shouldn't scroll while the dialog is up.
	useEffect(() => {
		if (!open) return;
		const root = document.documentElement;
		const previous = root.style.overflow;
		root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = previous;
		};
	}, [open]);

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby={titleId}
			aria-describedby={description ? descriptionId : undefined}
			// Esc: keep the dialog open until the parent says otherwise.
			onCancel={(e) => {
				e.preventDefault();
				// A modal opened from inside another one: React would bubble this to the outer dialog too.
				e.stopPropagation();
				onClose();
			}}
			// Clicks on the dialog element itself (not its content) land on the backdrop around it.
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			className={`m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] ${size === 'lg' ? 'max-w-3xl' : 'max-w-140'} overflow-hidden rounded-[28px] bg-surface-container-high p-0 text-on-surface shadow-xl backdrop:bg-black/40 open:flex open:flex-col`}
		>
			<div className="flex items-start gap-4 px-6 pt-6 pb-4">
				<div className="min-w-0 flex-1">
					<h2 id={titleId} className="text-title wrap-break-word">
						{title}
					</h2>
					{description && (
						<p id={descriptionId} className="mt-2 text-sm text-on-surface-variant">
							{description}
						</p>
					)}
				</div>
				<button
					type="button"
					className="icon-btn icon-btn-sm -mt-1 -mr-2 shrink-0 [&>span>svg]:size-5"
					aria-label="Close"
					onClick={onClose}
				>
					<span aria-hidden="true" className="inline-flex" dangerouslySetInnerHTML={{ __html: xmarkIcon }} />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
		</dialog>
	);
}
