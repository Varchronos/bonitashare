import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export const PLAIN_TEXT = 'Plain text';

// Content types that are text even though they don't start with text/.
const TEXT_TYPES = new Set(['application/json', 'application/ld+json', 'application/javascript', 'application/xml', 'application/x-sh', 'application/yaml', 'application/toml', 'application/sql']);

// The language to show a file as code in (a @codemirror/language-data name), or null to leave it to
// the generic preview. Most source files arrive as application/octet-stream, so the filename decides
// first (extension, or whole names like Dockerfile) and the content type is only a fallback.
// Only reads language-data's metadata here: the grammars load in the browser when the viewer needs one.
export function codeLanguage(filename: string, contentType: string | null): string | null {
	const match = LanguageDescription.matchFilename(languages, filename);
	if (match) return match.name;

	const type = contentType?.split(';')[0].trim();
	if (type && (type.startsWith('text/') || TEXT_TYPES.has(type))) return PLAIN_TEXT;
	return null;
}
