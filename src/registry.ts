/**
 * The plugin directory index — one object per published plugin:
 *
 *   { "id": "weekly-schedule", "name": "Weekly Schedule",
 *     "author": "xwtaidev", "repo": "xwtaidev/obsidian-weekly-schedule-plugin" }
 *
 * Only `repo` earns this file a 3.2 MB request: the stats file has no repository
 * field, so without the index a GitHub link cannot be built. We keep the ids we
 * track and throw the rest away, which is why the stored copy stays a few lines.
 *
 * Pure, so the parsing rules can be tested without the app.
 */

import { REPO_URL } from './constants';

export interface PluginInfo {
	/** `owner/name`, exactly as GitHub spells it. */
	repo?: string;
	/** The human name, for a tooltip — the id stays the label. */
	name?: string;
}

/** A repository path is two names and a slash; anything else is a typo or a URL. */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function readEntry(raw: unknown): PluginInfo | null {
	if (!raw || typeof raw !== 'object') return null;
	const { repo, name } = raw as Record<string, unknown>;

	const info: PluginInfo = {};
	if (typeof repo === 'string' && REPO_RE.test(repo)) info.repo = repo;
	if (typeof name === 'string' && name.trim()) info.name = name.trim();
	return Object.keys(info).length ? info : null;
}

/** Pulls the tracked ids out of a freshly downloaded index. */
export function readIndex(payload: unknown, ids: readonly string[]): Record<string, PluginInfo> {
	const out: Record<string, PluginInfo> = {};
	if (!Array.isArray(payload)) return out;

	const wanted = new Set(ids);
	for (const item of payload) {
		if (!item || typeof item !== 'object') continue;
		const id = (item as Record<string, unknown>).id;
		if (typeof id !== 'string' || !wanted.has(id)) continue;

		const info = readEntry(item);
		if (info) out[id] = info;
	}
	return out;
}

/** Reads the small map we keep on disk; same rules as a fresh download. */
export function readInfo(value: unknown, ids?: readonly string[]): Record<string, PluginInfo> {
	const out: Record<string, PluginInfo> = {};
	if (!value || typeof value !== 'object') return out;

	const wanted = ids ? new Set(ids) : null;
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		if (wanted && !wanted.has(id)) continue;
		const info = readEntry(raw);
		if (info) out[id] = info;
	}
	return out;
}

/** Where the source lives. Null when the plugin is not published yet. */
export function repoUrl(repo: string | undefined): string | null {
	return repo ? `${REPO_URL}${repo}` : null;
}
