/**
 * Reading the official stats file. Deliberately free of any Obsidian import so
 * that the parsing, formatting and staleness rules can be tested by plain node.
 *
 * Shape of the file, one key per plugin id:
 *
 *   { "weekly-schedule": { "downloads": 12873, "updated": 1763078400000 } }
 *
 * `downloads` counts installs *and* updates, so it is not a count of people.
 * `updated` is when Obsidian last recomputed that entry, which may lag a day
 * behind the file itself.
 *
 * One file holds every plugin, so tracking a list costs the same single request
 * as tracking one — which is the whole reason this plugin can afford a list.
 */

export interface StatsEntry {
	downloads: number;
	/** Normalised to epoch ms by {@link toEpochMs}. */
	updated?: number;
}

export type StatsFile = Record<string, StatsEntry>;

/** One plugin's number, as it came out of the file. */
export interface Entry {
	downloads: number;
	/** When Obsidian last recomputed the entry, epoch ms. */
	publishedAt?: number;
}

/**
 * Everything one fetch produced. `fetchedAt` is shared because the request is:
 * there is no such thing as a fresher row than the rest of the file.
 */
export interface Snapshot {
	fetchedAt: number;
	entries: Record<string, Entry>;
	/**
	 * Which ids this fetch actually asked about. Needed because "not in the
	 * file" is a permanent answer for an unpublished plugin — without this, a
	 * missing id would look like a hole to fill and re-download the whole file
	 * on every tick. Absent on snapshots written before this field existed.
	 */
	checkedIds?: string[];
}

/**
 * The stats file has carried `updated` as epoch seconds and as epoch
 * milliseconds depending on the day it was generated, and multiplying the
 * wrong one by a thousand lands in the year 58823. The two ranges do not
 * overlap anywhere near the present, so the magnitude decides.
 */
export function toEpochMs(value: number): number {
	return value < 1e11 ? value * 1000 : value;
}

/**
 * Returns null when the id is absent or the entry is not a count — a plugin that
 * was removed from the directory still has a stale key in some mirrors.
 */
export function readDownloads(stats: unknown, id: string): StatsEntry | null {
	if (!stats || typeof stats !== 'object') return null;
	const entry = (stats as Record<string, unknown>)[id];
	if (!entry || typeof entry !== 'object') return null;

	const { downloads, updated } = entry as Record<string, unknown>;
	if (typeof downloads !== 'number' || !Number.isFinite(downloads)) return null;

	return {
		downloads: Math.max(0, Math.trunc(downloads)),
		updated:
			typeof updated === 'number' && Number.isFinite(updated) ? toEpochMs(updated) : undefined,
	};
}

/**
 * Pulls several ids out of one parse. Ids that are not in the file are simply
 * absent from the result, so the caller can tell "not listed" from "zero".
 */
export function readMany(stats: unknown, ids: readonly string[]): Record<string, Entry> {
	const out: Record<string, Entry> = {};
	for (const id of ids) {
		const found = readDownloads(stats, id);
		if (found) out[id] = { downloads: found.downloads, publishedAt: found.updated };
	}
	return out;
}

/** Sum over the ids that are actually there. Missing ids contribute nothing. */
export function totalDownloads(snapshot: Snapshot | null, ids: readonly string[]): number {
	if (!snapshot) return 0;
	return ids.reduce((sum, id) => sum + (snapshot.entries[id]?.downloads ?? 0), 0);
}

/** The bare numbers, which is all a history sample keeps. */
export function countsOf(entries: Record<string, Entry>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [id, entry] of Object.entries(entries)) out[id] = entry.downloads;
	return out;
}

/** Ids the user tracks that the file did not have. */
export function missingIds(snapshot: Snapshot | null, ids: readonly string[]): string[] {
	if (!snapshot) return [...ids];
	return ids.filter((id) => !snapshot.entries[id]);
}

/**
 * Whether this snapshot already asked the file about every tracked id.
 *
 * Deliberately not the same question as {@link missingIds}: a plugin that is not
 * in the directory yet is missing forever, and re-reading the whole file every
 * half hour to confirm that would be a waste.
 */
export function coversIds(snapshot: Snapshot | null, ids: readonly string[]): boolean {
	if (!snapshot) return false;
	const checked = snapshot.checkedIds ?? Object.keys(snapshot.entries);
	return ids.every((id) => checked.includes(id));
}

/** Normalises a typed id: the id field is a filename, not prose. */
export function normalizeId(raw: string): string {
	return raw.trim().toLowerCase();
}

/** Trims, lowercases, drops blanks and duplicates, keeps the order given. */
export function normalizeList(raw: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of raw) {
		const id = normalizeId(item);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function groupThousands(value: number): string {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 12,873 — exact, for the panel, the settings tab and the notice. */
export function formatFull(value: number): string {
	return groupThousands(Math.max(0, Math.trunc(value)));
}

/**
 * 12.9k / 1.2M — for the status bar, where width is not ours to spend.
 * One decimal, but no trailing `.0`: a round thousand reads as "12k", not "12.0k".
 */
export function formatCompact(value: number): string {
	const n = Math.max(0, Math.trunc(value));
	if (n < 1000) return String(n);

	const [divisor, suffix] = n < 1_000_000 ? [1_000, 'k'] : [1_000_000, 'M'];
	const scaled = n / divisor;
	const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '');
	return `${text}${suffix}`;
}

/** True when there is nothing to show, or what we have is old enough to replace. */
export function isStale(fetchedAt: number | null | undefined, ttlHours: number, now: number): boolean {
	if (!fetchedAt) return true;
	const ttlMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
	return now - fetchedAt >= ttlMs;
}

/** Local time, because "when did I last check" is a human question. */
export function formatWhen(epochMs: number): string {
	const date = new Date(epochMs);
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 11-02 — for the axis under the curve, where the year is noise. */
export function formatShortDate(epochMs: number): string {
	const date = new Date(epochMs);
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
