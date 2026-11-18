import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { githubDarkInit, githubLightInit } from '@uiw/codemirror-theme-github';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ApiResponse } from '@bonitashare/shared-types';
import type { FileText } from '@/lib/file';
import { PLAIN_TEXT } from '@/lib/code-lang';

type Props = {
	fileId: string;
	// A @codemirror/language-data name, from codeLanguage() on the server.
	language: string;
	downloadUrl: string;
};

type State = { status: 'loading' } | { status: 'ok'; text: string; truncated: boolean } | { status: 'not-text' } | { status: 'error' };

// GitHub's syntax colours on the card's own surface: the themes' backgrounds would cover it otherwise.
const onCard = { background: 'transparent', gutterBackground: 'transparent', gutterBorder: 'transparent', gutterForeground: 'var(--color-on-surface-variant)' };
const lightTheme = githubLightInit({ settings: onCard });
const darkTheme = githubDarkInit({ settings: onCard });

// The site's type scale.
const surface = EditorView.theme({
	'&': { fontSize: '0.875rem' },
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { lineHeight: '1.5rem' },
	'.cm-content': { paddingBlock: '0.75rem' },
});

// Read-only, but still focusable, so the cursor, selection and Ctrl+F search work.
const SETUP = {
	highlightActiveLine: false,
	highlightActiveLineGutter: false,
	autocompletion: false,
	closeBrackets: false,
	indentOnInput: false,
	history: false,
	dropCursor: false,
};

// A shared text or source file in CodeMirror: line numbers, folding, search, highlighting for the
// file's language. Fetches the text itself so the page doesn't wait on it.
export default function CodeViewer({ fileId, language, downloadUrl }: Props) {
	const [state, setState] = useState<State>({ status: 'loading' });
	const [lang, setLang] = useState<Extension | null>(null);
	const [wrap, setWrap] = useState(false);
	const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
	const dark = useDarkTheme();

	useEffect(() => {
		fetch(`/api/v1/text/${encodeURIComponent(fileId)}`)
			.then((res) => res.json() as Promise<ApiResponse<FileText>>)
			.then((json) => {
				if (json.data) setState({ status: 'ok', ...json.data });
				else setState({ status: json.error?.code === 'NOT_TEXT' ? 'not-text' : 'error' });
			})
			.catch(() => setState({ status: 'error' }));
	}, [fileId]);

	// Each language's grammar is its own chunk, fetched only for files that need it.
	useEffect(() => {
		LanguageDescription.matchLanguageName(languages, language)
			?.load()
			.then(setLang)
			// Unhighlighted is still readable.
			.catch(() => {});
	}, [language]);

	if (state.status === 'not-text') {
		return <p className="card p-8 text-center text-on-surface-variant">No preview available for this file type.</p>;
	}

	const text = state.status === 'ok' ? state.text : '';
	const lineCount = text.replace(/\r?\n$/, '').split(/\r?\n/).length;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied('copied');
		} catch {
			setCopied('failed');
		}
		setTimeout(() => setCopied(null), 2000);
	};

	return (
		<div className="card overflow-hidden">
			<div className="flex items-center justify-between gap-3 border-b border-outline-variant/60 py-1 pr-1 pl-4">
				<span className="truncate text-xs text-on-surface-variant">
					<span className="font-medium">{language === PLAIN_TEXT ? 'Text' : language}</span>
					{state.status === 'ok' && ` · ${lineCount.toLocaleString('en')} ${lineCount === 1 ? 'line' : 'lines'}`}
				</span>
				{state.status === 'ok' && (
					<div className="flex shrink-0 items-center">
						<button type="button" className="btn btn-text btn-sm" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
							{wrap ? 'No wrap' : 'Wrap'}
						</button>
						<button type="button" className="btn btn-text btn-sm" onClick={copy}>
							{copied === 'copied' ? 'Copied' : copied === 'failed' ? "Couldn't copy" : 'Copy'}
						</button>
					</div>
				)}
			</div>
			{state.status === 'ok' ? (
				// Black under the code in dark mode: the syntax colours read better on it than on the card's surface.
				<div className="dark:bg-black">
					<CodeMirror
						value={text}
						readOnly
						basicSetup={SETUP}
						theme={dark ? darkTheme : lightTheme}
						extensions={[surface, ...(lang ? [lang] : []), ...(wrap ? [EditorView.lineWrapping] : [])]}
						maxHeight="75svh"
					/>
				</div>
			) : (
				<p className="flex h-48 items-center justify-center text-sm text-on-surface-variant">
					{state.status === 'loading' ? 'Loading…' : "Couldn't load this file's contents."}
				</p>
			)}
			{state.status === 'ok' && state.truncated && (
				<p className="border-t border-outline-variant/60 px-4 py-2 text-xs text-on-surface-variant">
					Showing the first 1 MB.{' '}
					<a className="text-primary hover:underline" href={downloadUrl}>
						Download the file
					</a>{' '}
					to see all of it.
				</p>
			)}
		</div>
	);
}

// Follows <html data-theme>, which the navbar toggle flips without a reload.
function useDarkTheme() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const root = document.documentElement;
		const update = () => setDark(root.dataset.theme === 'dark');
		update();
		const observer = new MutationObserver(update);
		observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	}, []);
	return dark;
}
