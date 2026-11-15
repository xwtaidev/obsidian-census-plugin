import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	coversIds,
	formatCompact,
	formatFull,
	formatWhen,
	isStale,
	keyOf,
	missingIds,
	normalizeId,
	normalizePluginList,
	normalizeThemeList,
	normalizeThemeName,
	parseKey,
	readDownloads,
	readMany,
	toEpochMs,
	totalDownloads,
} from './stats';

test('readDownloads takes the count out of the official shape', () => {
	// Whatever unit the file used that day, the reading stores epoch ms.
	const stats = { 'weekly-schedule': { downloads: 12873, updated: 1763078400 } };
	assert.deepEqual(readDownloads(stats, 'weekly-schedule'), {
		downloads: 12873,
		updated: 1763078400000,
	});
});

test('readDownloads reads the theme endpoint’s spelling too', () => {
	// Themes say `download`, and have no timestamp at all — the shape is one
	// field wide.
	assert.deepEqual(readDownloads({ Minimal: { id: 'Minimal', download: 2766179 } }, 'Minimal'), {
		downloads: 2766179,
		updated: undefined,
	});
});

test('readDownloads keeps the two spellings apart from a non-count', () => {
	assert.equal(readDownloads({ x: { download: '12' } }, 'x'), null);
	assert.equal(readDownloads({ x: { download: Number.NaN } }, 'x'), null);
});

test('readDownloads tolerates an entry without a timestamp', () => {
	assert.deepEqual(readDownloads({ coffer: { downloads: 7 } }, 'coffer'), {
		downloads: 7,
		updated: undefined,
	});
});

test('readDownloads returns null for ids that are not there', () => {
	assert.equal(readDownloads({ coffer: { downloads: 7 } }, 'census'), null);
	assert.equal(readDownloads({}, 'census'), null);
	assert.equal(readDownloads(null, 'census'), null);
	assert.equal(readDownloads('{}', 'census'), null);
});

test('readDownloads rejects entries that are not counts', () => {
	assert.equal(readDownloads({ x: { downloads: '12' } }, 'x'), null);
	assert.equal(readDownloads({ x: { downloads: Number.NaN } }, 'x'), null);
	assert.equal(readDownloads({ x: {} }, 'x'), null);
	assert.equal(readDownloads({ x: 12 }, 'x'), null);
});

test('readDownloads clamps instead of returning nonsense', () => {
	assert.equal(readDownloads({ x: { downloads: -4 } }, 'x')?.downloads, 0);
	assert.equal(readDownloads({ x: { downloads: 12.9 } }, 'x')?.downloads, 12);
});

test('toEpochMs normalises seconds and leaves milliseconds alone', () => {
	const ms = new Date(2026, 10, 13, 15, 3).getTime();
	assert.equal(toEpochMs(ms / 1000), ms);
	assert.equal(toEpochMs(ms), ms);
	// The bug this exists for: 1.76e12 read as seconds lands in the year 58823.
	assert.ok(new Date(toEpochMs(ms)).getFullYear() < 3000);
});

test('readMany pulls several ids out of one parse', () => {
	const stats = {
		coffer: { downloads: 340 },
		'weekly-schedule': { downloads: 12873, updated: 1763078400000 },
	};
	assert.deepEqual(readMany(stats, ['weekly-schedule', 'coffer']), {
		coffer: { downloads: 340, publishedAt: undefined },
		'weekly-schedule': { downloads: 12873, publishedAt: 1763078400000 },
	});
});

test('readMany simply omits ids that are not listed', () => {
	// "Not listed" has to be distinguishable from "zero downloads", so the key
	// is absent rather than set to 0.
	assert.deepEqual(readMany({ coffer: { downloads: 2 } }, ['coffer', 'ghost']), {
		coffer: { downloads: 2, publishedAt: undefined },
	});
	assert.deepEqual(readMany(null, ['coffer']), {});
});

test('totalDownloads adds up only what is there', () => {
	const snapshot = {
		fetchedAt: 1,
		entries: {
			a: { downloads: 100 },
			b: { downloads: 23 },
		},
	};
	assert.equal(totalDownloads(snapshot, ['a', 'b']), 123);
	assert.equal(totalDownloads(snapshot, ['a', 'b', 'missing']), 123);
	assert.equal(totalDownloads(null, ['a']), 0);
	assert.equal(totalDownloads(snapshot, []), 0);
});

test('missingIds reports what the snapshot does not cover', () => {
	const snapshot = { fetchedAt: 1, entries: { a: { downloads: 1 } } };
	assert.deepEqual(missingIds(snapshot, ['a']), []);
	assert.deepEqual(missingIds(snapshot, ['a', 'b']), ['b']);
	assert.deepEqual(missingIds(null, ['a', 'b']), ['a', 'b']);
});

test('coversIds tells "already asked" apart from "has a number"', () => {
	// `ghost` was asked about and was not in the file. That is an answer, not a
	// hole — re-reading 2.5 MB every tick to confirm it would be waste.
	const snapshot = {
		fetchedAt: 1,
		entries: { a: { downloads: 1 } },
		checkedIds: ['a', 'ghost'],
	};
	assert.equal(coversIds(snapshot, ['a']), true);
	assert.equal(coversIds(snapshot, ['a', 'ghost']), true);
	assert.equal(coversIds(snapshot, ['a', 'ghost', 'new']), false);
	assert.equal(coversIds(null, ['a']), false);
});

test('coversIds falls back to the entries keys on snapshots from older builds', () => {
	const legacy = { fetchedAt: 1, entries: { a: { downloads: 1 } } };
	assert.equal(coversIds(legacy, ['a']), true);
	assert.equal(coversIds(legacy, ['a', 'b']), false);
});

test('normalizeId keeps ids comparable', () => {
	assert.equal(normalizeId('  Weekly-Schedule '), 'weekly-schedule');
	assert.equal(normalizeId(''), '');
});

test('normalizePluginList trims, lowercases, drops blanks and duplicates, keeps order', () => {
	assert.deepEqual(normalizePluginList([' Timeblock ', 'coffer', '', 'coffer', 'COFFER']), [
		'timeblock',
		'coffer',
	]);
	assert.deepEqual(normalizePluginList([]), []);
});

test('normalizeThemeName only tidies whitespace', () => {
	// The name is the key, and the keys are case-sensitive: lowercasing here
	// would quietly read `minimal` (four downloads) instead of `Minimal`.
	assert.equal(normalizeThemeName('  Blue   Topaz '), 'Blue Topaz');
	assert.equal(normalizeThemeName('anuppuccin'), 'anuppuccin');
});

test('normalizeThemeList keeps two themes that differ only by case', () => {
	assert.deepEqual(normalizeThemeList([' Minimal ', 'Minimal', 'minimal', '']), ['Minimal', 'minimal']);
});

test('keyOf and parseKey round-trip a target into a reading key', () => {
	assert.equal(keyOf({ kind: 'plugin', id: 'weekly-schedule' }), 'plugin:weekly-schedule');
	assert.equal(keyOf({ kind: 'theme', id: 'Blue Topaz' }), 'theme:Blue Topaz');
	assert.deepEqual(parseKey('theme:Blue Topaz'), { kind: 'theme', id: 'Blue Topaz' });
	// A bare id is a key from before themes existed — not something to parse.
	assert.equal(parseKey('weekly-schedule'), null);
	assert.equal(parseKey('plugin:'), null);
	assert.equal(parseKey('snippet:x'), null);
});

test('formatFull groups thousands', () => {
	assert.equal(formatFull(0), '0');
	assert.equal(formatFull(999), '999');
	assert.equal(formatFull(1000), '1,000');
	assert.equal(formatFull(12873), '12,873');
	assert.equal(formatFull(1234567), '1,234,567');
});

test('formatCompact spends as little width as it can', () => {
	assert.equal(formatCompact(0), '0');
	assert.equal(formatCompact(999), '999');
	assert.equal(formatCompact(1000), '1k');
	assert.equal(formatCompact(12873), '12.9k');
	assert.equal(formatCompact(123456), '123k');
	assert.equal(formatCompact(1_000_000), '1M');
	assert.equal(formatCompact(1_250_000), '1.3M');
	assert.equal(formatCompact(12_000_000), '12M');
});

test('isStale trusts a snapshot for the configured window', () => {
	const now = 1_763_000_000_000;

	assert.equal(isStale(null, 12, now), true);
	assert.equal(isStale(undefined, 12, now), true);
	assert.equal(isStale(now - 60 * 60 * 1000, 12, now), false);
	assert.equal(isStale(now - 13 * 60 * 60 * 1000, 12, now), true);
	// Exactly the window is already stale — the boundary belongs to the past.
	assert.equal(isStale(now - 60 * 60 * 1000, 1, now), true);
	// A zero or negative window still means "at least an hour", not "always stale".
	assert.equal(isStale(now - 30 * 60 * 1000, 0, now), false);
	assert.equal(isStale(now - 30 * 60 * 1000, -5, now), false);
});

test('formatWhen prints local time, zero padded', () => {
	const stamp = new Date(2026, 10, 14, 9, 5).getTime();
	assert.equal(formatWhen(stamp), '2026-11-14 09:05');
});
