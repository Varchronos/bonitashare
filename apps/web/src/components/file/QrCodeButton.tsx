import { useState } from 'react';
import Modal from '../Modal';

type Props = {
	// The page's own link, which the code points to.
	url: string;
	// The QR code as SVG markup, made on the server (FileActions.astro) so the library isn't shipped here.
	svg: string;
};

// Opens this page on a phone: scan the code instead of copying the link over. Hidden on touch devices,
// which are the phone already.
export default function QrCodeButton({ url, svg }: Props) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button type="button" className="btn btn-text pointer-coarse:hidden" onClick={() => setOpen(true)}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2" />
				</svg>
				Open on phone
			</button>

			<Modal open={open} onClose={() => setOpen(false)} title="Open on your phone" description="Point your phone's camera at the code to open this page there.">
				{/* Dark on white whatever the theme: some scanners can't read a light-on-dark code. */}
				<div
					role="img"
					aria-label={`QR code for ${url}`}
					className="mx-auto size-64 max-w-full rounded-2xl bg-white p-2 [&>svg]:block [&>svg]:size-full"
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
				<p className="mt-4 text-center text-sm break-all text-on-surface-variant select-all">{url}</p>
			</Modal>
		</>
	);
}
