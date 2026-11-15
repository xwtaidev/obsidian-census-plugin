/**
 * The curve in the panel needs a series, and the official numbers only ever
 * carry today's total — they are a snapshot, not a log. So the series is ours.
 *
 * Two sources feed it, and both speak the same vocabulary:
 *
 *  - a sample recorded whenever a check lands on a day we have not recorded
 *    yet. One per UTC day, because that is the cadence the plugin file is
 *    rewritten at: the bot commits it just after 00:00 UTC;
 *  - an optional backfill that walks that file's own git history, so a fresh
 *    install is not staring at an empty chart for a week. Themes have no such
 *    file and therefore no backfill — a theme curve starts the day it is added.
 *
 * Counts are filed under `<kind>:<id>`, so one array can hold both directories
 * without the two ever colliding.
 *
 * Pure, like `stats.ts`: the arithmetic of a curve should not need an app to
 * prove, and the shapes here (paths, deltas) are exactly what tends to be
 * quietly wrong in ways only a test notices.
 */

import { HISTORY_MAX_SAMPLES } from './constants';
import { parseKey } from './stats';

export interface Sample {
	/** Start of the UTC day this sample describes, epoch ms. */
	t: number;
	/** Downloads per target key (`plugin:id`, `theme:name`). */
	counts: Record<string, number>;
}

/** One commit of the stats file: which file to read, and which day it is. */
export interface CommitRef {
	sha: string;
	t: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the day `t` falls in. */
export function dayStart(t: number): number {
	return Math.floor(t / DAY_MS) * DAY_MS;
}

/** Days are the unit, so two readings of one day are one point, not two. */
export function trimSamples(history: readonly Sample[], max = HISTORY_MAX_SAMPLES): Sample[] {
	const byDay = new Map<number, Sample>();
	for (const sample of history) {
		const day = dayStart(sample.t);
		const seen = byDay.get(day);
		byDay.set(
			day,
			// A later sample for a day fills in the ids the earlier one missed
			// instead of replacing the whole reading.
			seen ? { t: day, counts: { ...seen.counts, ...sample.counts } } : { t: day, counts: { ...sample.counts } },
		);
	}

	const sorted = [...byDay.values()].sort((a, b) => a.t - b.t);
	return max > 0 && sorted.length > max ? sorted.slice(sorted.length - max) : sorted;
}

/**
 * Records one reading. Reading the same day twice replaces that day's point —
 * a second point for the same day would make the curve lie about how often it
 * is sampled, which is also what the footer claims.
 */
export function recordSample(
	history: readonly Sample[],
	t: number,
	counts: Record<string, number>,
	max = HISTORY_MAX_SAMPLES,
): Sample[] {
	const day = dayStart(t);
	const out = [...history];
	const last = out[out.length - 1];

	if (last && dayStart(last.t) === day) {
		out[out.length - 1] = { t: day, counts: { ...last.counts, ...counts } };
		return trimSamples(out, max);
	}

	out.push({ t: day, counts: { ...counts } });
	return trimSamples(out, max);
}

/**
 * Reads a stored `history` field. Anything malformed is dropped rather than
 * repaired: a wrong point is worse than a missing one.
 */
export function readHistory(value: unknown, max = HISTORY_MAX_SAMPLES): Sample[] {
	if (!Array.isArray(value)) return [];

	const out: Sample[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') continue;
		const { t, counts } = item as Record<string, unknown>;
		if (typeof t !== 'number' || !Number.isFinite(t)) continue;
		if (!counts || typeof counts !== 'object') continue;

		const clean: Record<string, number> = {};
		for (const [id, count] of Object.entries(counts as Record<string, unknown>)) {
			if (typeof count === 'number' && Number.isFinite(count)) clean[id] = Math.max(0, Math.trunc(count));
		}
		out.push({ t: dayStart(t), counts: clean });
	}
	return trimSamples(out, max);
}

/**
 * Keys became `<kind>:<id>` the day themes arrived. Readings written before
 * that carry bare plugin ids; they are not junk, they are the only curve a user
 * has, so they are re-filed as what they were rather than thrown away.
 */
export function migrateKeys(samples: readonly Sample[]): Sample[] {
	return samples.map((sample) => {
		const counts: Record<string, number> = {};
		for (const [key, value] of Object.entries(sample.counts)) {
			counts[parseKey(key) ? key : `plugin:${key}`] = value;
		}
		return { t: sample.t, counts };
	});
}

/** A day's total across the ids that were tracked at the time. */
export function totalOf(sample: Sample, ids: readonly string[]): number {
	return ids.reduce((sum, id) => sum + (sample.counts[id] ?? 0), 0);
}

/** The samples inside the window, oldest first. */
export function windowOf(history: readonly Sample[], days: number, now: number): Sample[] {
	const span = Math.max(1, Math.round(days));
	const from = dayStart(now) - (span - 1) * DAY_MS;
	return [...history].sort((a, b) => a.t - b.t).filter((sample) => dayStart(sample.t) >= from);
}

export interface Change {
	from: number;
	to: number;
	delta: number;
	/** Percent of `from`. Null when `from` is zero, where a ratio says nothing. */
	pct: number | null;
}

/**
 * Movement across the window. Null until there are two days to compare —
 * "no curve" and "no change" are different answers and must not look alike.
 */
export function changeOf(
	history: readonly Sample[],
	ids: readonly string[],
	days: number,
	now: number,
): Change | null {
	const totals = windowOf(history, days, now).map((sample) => totalOf(sample, ids));
	const first = totals[0];
	const last = totals[totals.length - 1];
	if (totals.length < 2 || first === undefined || last === undefined) return null;

	const delta = last - first;
	return { from: first, to: last, delta, pct: first > 0 ? (delta / first) * 100 : null };
}

/** One plugin's movement across the window, skipping days it was not in. */
export function changeFor(history: readonly Sample[], id: string, days: number, now: number): number | null {
	const values = windowOf(history, days, now)
		.map((sample) => sample.counts[id])
		.filter((value): value is number => typeof value === 'number');

	const first = values[0];
	const last = values[values.length - 1];
	if (values.length < 2 || first === undefined || last === undefined) return null;
	return last - first;
}

/**
 * Merges a backfilled stretch into what we already sampled. Days we recorded
 * ourselves win: they were read at a known moment, whereas a commit's date is
 * the bot's, a few minutes before the numbers it carries.
 */
export function mergeSamples(existing: readonly Sample[], incoming: readonly Sample[]): Sample[] {
	const byDay = new Map<number, Sample>();
	for (const sample of existing) {
		const day = dayStart(sample.t);
		byDay.set(day, { t: day, counts: { ...sample.counts } });
	}
	for (const sample of incoming) {
		const day = dayStart(sample.t);
		const seen = byDay.get(day);
		byDay.set(day, { t: day, counts: seen ? { ...sample.counts, ...seen.counts } : { ...sample.counts } });
	}
	return [...byDay.values()].sort((a, b) => a.t - b.t);
}

export interface Spark {
	/** `M x,y L x,y …` — the curve. */
	line: string;
	/** The same line, closed along the bottom — the fill under it. */
	area: string;
	/** Where the last point sits, for the dot that says "you are here". */
	last: { x: number; y: number };
	min: number;
	max: number;
}

/**
 * Fits a series into a box.
 *
 * Scaled to the data range, not to zero: thirty days of a steady plugin is a
 * two-percent rise, and against a zero baseline that is a flat line that says
 * nothing. The delta next to it carries the magnitude instead. A series with
 * no range at all is drawn through the middle, where it reads as "steady"
 * rather than as "nothing".
 */
export function sparkOf(
	values: readonly number[],
	width: number,
	height: number,
	pad = 5,
): Spark | null {
	if (!values.length) return null;

	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min;
	const top = pad;
	const bottom = Math.max(pad, height - pad);

	const atX = (index: number): number =>
		values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
	const atY = (value: number): number =>
		span === 0 ? (top + bottom) / 2 : bottom - ((value - min) / span) * (bottom - top);

	const round = (n: number): number => Math.round(n * 100) / 100;
	const points = values.map((value, index) => `${round(atX(index))},${round(atY(value))}`);
	const line = `M${points.join(' L')}`;
	const area = `${line} L${round(width)},${height} L${round(atX(0))},${height} Z`;
	const lastValue = values[values.length - 1] ?? min;

	return {
		line,
		area,
		last: { x: round(atX(values.length - 1)), y: round(atY(lastValue)) },
		min,
		max,
	};
}

/** Commit dates out of GitHub's listing, skipping anything unexpected. */
export function readCommits(payload: unknown): CommitRef[] {
	if (!Array.isArray(payload)) return [];

	const out: CommitRef[] = [];
	for (const item of payload) {
		if (!item || typeof item !== 'object') continue;
		const { sha, commit } = item as Record<string, unknown>;
		if (typeof sha !== 'string') continue;
		if (!commit || typeof commit !== 'object') continue;

		const committer = (commit as Record<string, unknown>).committer;
		if (!committer || typeof committer !== 'object') continue;
		const date = (committer as Record<string, unknown>).date;
		if (typeof date !== 'string') continue;

		const t = Date.parse(date);
		if (!Number.isFinite(t)) continue;
		out.push({ sha, t });
	}
	return out;
}

/**
 * One commit per day, newest first. The listing is already newest-first, so the
 * first commit seen for a day is the last one that day — the reading closest to
 * midnight, which is what the file's daily cadence actually publishes.
 */
export function pickDailyCommits(commits: readonly CommitRef[], days: number): CommitRef[] {
	const byDay = new Map<number, CommitRef>();
	for (const commit of commits) {
		const day = dayStart(commit.t);
		if (!byDay.has(day)) byDay.set(day, commit);
	}
	return [...byDay.values()].sort((a, b) => b.t - a.t).slice(0, Math.max(1, days));
}
