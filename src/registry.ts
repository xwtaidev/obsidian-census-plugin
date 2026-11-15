/**
 * The directory indexes — one object per published entry:
 *
 *   plugins: { "id": "weekly-schedule", "name": "Weekly Schedule",
 *              "author": "xwtaidev", "repo": "xwtaidev/obsidian-weekly-schedule-plugin" }
 *   themes:  { "name": "Minimal", "author": "kepano", "repo": "kepano/obsidian-minimal",
 *              "screenshot": "screenshot.png", "modes": ["dark", "light"] }
 *
 * Only `repo` earns these files a request: neither stats document carries a
 * repository, so without the index a GitHub link cannot be built. The field
 * naming the entry differs — plugins have an `id`, themes only a display name —
 * which is the whole reason there are two readers below and not one.
 *
 * Pure, so the parsing rules can be tested without the app.
 */

import { REPO_URL, THEME_PAGE_URL } from './constants';

export interface TargetInfo {
	/** `owner/name`, exactly as GitHub spells it. */
	repo?: string;
	/** The human name, for a tooltip — the id stays the label. */
	name?: string;
	/** Themes list one; plugins mostly do too. Shown in a tooltip. */
	author?: string;
}

/** A repository path is two names and a slash; anything else is a typo or a URL. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function readEntry(raw: unknown): TargetInfo | null {
	if (!raw || typeof raw !== 'object') return null;
	const { repo, name, author } = raw as Record<string, unknown>;

	const info: TargetInfo = {};
	if (typeof repo === 'string' && REPO_RE.test(repo)) info.repo = repo;
	if (typeof name === 'string' && name.trim()) info.name = name.trim();
	if (typeof author === 'string' && author.trim()) info.author = author.trim();
	return Object.keys(info).length ? info : null;
}

/**
 * Pulls the tracked entries out of a freshly downloaded index.
 *
 * `field` is `id` for plugins and `name` for themes; everything else about the
 * two documents is the same array of objects, so one walk serves both.
 */
function readDirectory(
	payload: unknown,
	field: 'id' | 'name',
	wanted: ReadonlySet<string>,
): Record<string, TargetInfo> {
	const out: Record<string, TargetInfo> = {};
	if (!Array.isArray(payload)) return out;

	for (const item of payload) {
		if (!item || typeof item !== 'object') continue;
		const key = (item as Record<string, unknown>)[field];
		if (typeof key !== 'string' || !wanted.has(key)) continue;

		const info = readEntry(item);
		if (info) out[key] = info;
	}
	return out;
}

/** Plugins, matched on their id. */
export function readIndex(payload: unknown, ids: readonly string[]): Record<string, TargetInfo> {
	return readDirectory(payload, 'id', new Set(ids));
}

/** Themes, matched on their display name — exact, capitals and all. */
export function readThemeIndex(
	payload: unknown,
	names: readonly string[],
): Record<string, TargetInfo> {
	return readDirectory(payload, 'name', new Set(names));
}

/** Reads the small map we keep on disk; same rules as a fresh download. */
export function readInfo(value: unknown, ids?: readonly string[]): Record<string, TargetInfo> {
	const out: Record<string, TargetInfo> = {};
	if (!value || typeof value !== 'object') return out;

	const wanted = ids ? new Set(ids) : null;
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		if (wanted && !wanted.has(id)) continue;
		const info = readEntry(raw);
		if (info) out[id] = info;
	}
	return out;
}

/** Where the source lives. Null when the entry is not published yet. */
export function repoUrl(repo: string | undefined): string | null {
	return repo ? `${REPO_URL}${repo}` : null;
}

/**
 * The path a theme's page lives at, derived from its name.
 *
 * The site's rule is "lowercase, keep letters and digits, one hyphen between
 * words, drop everything else" — checked against the whole directory, including
 * the awkward ones: `Rosé Pine` → `ros-pine` (the accent is removed, not
 * turned into a separator), `OLED.Black` → `oledblack`, `Dracula + LYT` →
 * `dracula-lyt`, `Synthwave '84` → `synthwave-84`.
 */
export function themeSlug(name: string): string {
	return name
		.split(/\s+/)
		.map((word) =>
			[...word.toLowerCase()].filter((char) => (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')).join(''),
		)
		.filter(Boolean)
		.join('-');
}

/** The theme's page on the community site; null when the name yields no slug. */
export function themePageUrl(name: string): string | null {
	const slug = themeSlug(name);
	return slug ? `${THEME_PAGE_URL}${slug}` : null;
}
