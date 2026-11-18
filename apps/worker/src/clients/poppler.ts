import path from 'node:path';
import { Poppler } from 'node-poppler';
import sharp from 'sharp';

// Finds the poppler-utils binaries on PATH, and throws at startup if they're missing.
export const poppler = new Poppler();

// Uploaded PDFs are untrusted input to a C parser, so a page that won't render in this time is given up on.
const RENDER_TIMEOUT_MS = 30_000;

// Renders the PDF's first page into workdir and returns it as a WebP thumbnail.
// Rejects when poppler can't render it (corrupt, encrypted, not a PDF) or runs past the timeout.
export async function convertToWebp(pdfPath: string, workdir: string): Promise<Buffer> {
    const outBase = path.join(workdir, 'page');
    // -scale-to caps the longer side, so a page with a huge declared size still renders small.
    await poppler.pdfToCairo(
        pdfPath,
        outBase,
        { firstPageToConvert: 1, lastPageToConvert: 1, singleFile: true, pngFile: true, scalePageTo: 800 },
        { signal: AbortSignal.timeout(RENDER_TIMEOUT_MS) },
    );

    // White background: pages with no fill render transparent, which reads as black on dark UIs.
    return sharp(`${outBase}.png`)
        .flatten({ background: '#ffffff' })
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
}
