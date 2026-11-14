import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type Sample,
	changeFor,
	changeOf,
	dayStart,
	mergeSamples,
	pickDailyCommits,
	readCommits,
	readHistory,
	recordSample,
	sparkOf,
	totalOf,
	trimSamples,
	windowOf,
} from './history';

/** UTC builders: the day bucket is a UTC day, so the tests speak UTC. */
const at = (month: number, day: number, hour = 0): number => Date.UTC(2026, month - 1, day, hour);

test('dayStart lands on UTC midnight', () => {
	assert.equal(dayStart(at(11, 14, 23)), at(11, 14));
	assert.equal(dayStart(at(11, 14, 0)), at(11, 14));
	// 00:13 UTC is when the bot commits; whatever hour we read at, it is one day.
	assert.equal(dayStart(at(11, 14, 0) + 13 * 60 * 1000), at(11, 14));
});

test('recordSample adds one point per day', () => {
	let history = recordSample([], at(11, 12, 3), { a: 100 });
	history = recordSample(history, at(11, 13, 3), { a: 120 });

	assert.equal(history.length, 2);
	assert.equal(history[0]?.t, at(11, 12));
	assert.equal(history[1]?.counts.a, 120);
});

test('recordSample replaces the same day instead of adding a second point', () => {
	// Two points for one day would make the footer's sample count — and the
	// curve's idea of its own cadence — dishonest.
	let history = recordSample([], at(11, 12, 1), { a: 100 });
	history = recordSample(history, at(11, 12, 20), { a: 104 });

	assert.equal(history.length, 1);
	assert.equal(history[0]?.counts.a, 104);
});

test('recordSample keeps a count the later reading did not mention', () => {
	// A plugin pulled from the directory between two checks of one day must
	// not lose the number it had that morning.
	let history = recordSample([], at(11, 12, 1), { a: 100, b: 5 });
	history = recordSample(history, at(11, 12, 22), { a: 104 });

	assert.deepEqual(history[0]?.counts, { a: 104, b: 5 });
});

test('trimSamples keeps the newest points and stays sorted', () => {
	const history = [1, 2, 3, 4, 5].map((day) => ({ t: at(11, day), counts: { a: day } }));
	assert.deepEqual(
		trimSamples(history, 3).map((sample) => sample.counts.a),
		[3, 4, 5],
	);
	// A zero maximum means "no cap", which is what loading from disk uses.
	assert.equal(trimSamples(history, 0).length, 5);
});

test('trimSamples folds two entries for one day into one', () => {
	const folded = trimSamples([
		{ t: at(11, 12, 1), counts: { a: 1 } },
		{ t: at(11, 12, 9), counts: { b: 2 } },
	]);
	assert.deepEqual(folded, [{ t: at(11, 12), counts: { a: 1, b: 2 } }]);
});

test('readHistory drops anything malformed rather than guessing', () => {
	const history = readHistory([
		{ t: at(11, 12), counts: { a: 10 } },
		{ t: 'yesterday', counts: { a: 11 } },
		{ counts: { a: 12 } },
		null,
		'14',
		{ t: at(11, 13), counts: { a: 12.9, b: -3 } },
	]);

	assert.equal(history.length, 2);
	assert.deepEqual(history[1], { t: at(11, 13), counts: { a: 12, b: 0 } });
	assert.deepEqual(readHistory(undefined), []);
	assert.deepEqual(readHistory({}), []);
});

test('totalOf adds only the ids that were tracked', () => {
	const sample = { t: at(11, 14), counts: { a: 10, b: 5, ghost: 99 } };
	assert.equal(totalOf(sample, ['a', 'b']), 15);
	assert.equal(totalOf(sample, ['a', 'missing']), 10);
	assert.equal(totalOf(sample, []), 0);
});

test('windowOf cuts at the start of the window and sorts', () => {
	const history = [10, 11, 12, 13, 14].map((day) => ({ t: at(11, day), counts: { a: day } }));
	assert.deepEqual(
		windowOf(history, 3, at(11, 14, 12)).map((sample) => sample.t),
		[at(11, 12), at(11, 13), at(11, 14)],
	);
	// Input order is not trusted: a merged history can arrive shuffled.
	assert.equal(windowOf([...history].reverse(), 30, at(11, 14, 12))[0]?.t, at(11, 10));
});

test('changeOf reports the movement across the window', () => {
	const history = [
		{ t: at(11, 1), counts: { a: 1000, b: 100 } },
		{ t: at(11, 2), counts: { a: 1100, b: 100 } },
	];
	const change = changeOf(history, ['a', 'b'], 30, at(11, 2, 12));

	assert.equal(change?.delta, 100);
	assert.ok(change?.pct !== null && Math.abs(change.pct - 9.0909) < 0.001);
});

test('changeOf needs two days to say anything', () => {
	const one = [{ t: at(11, 2), counts: { a: 10 } }];
	assert.equal(changeOf(one, ['a'], 30, at(11, 2, 12)), null);
	assert.equal(changeOf([], ['a'], 30, at(11, 2, 12)), null);
});

test('changeOf leaves the percentage null when it starts from nothing', () => {
	const history: Sample[] = [
		{ t: at(11, 1), counts: {} },
		{ t: at(11, 2), counts: { a: 4 } },
	];
	const change = changeOf(history, ['a'], 30, at(11, 2, 12));
	assert.equal(change?.delta, 4);
	assert.equal(change?.pct, null);
});

test('changeFor follows one id and skips the days it was not in', () => {
	const history: Sample[] = [
		{ t: at(11, 1), counts: { b: 5 } },
		{ t: at(11, 2), counts: { a: 10, b: 5 } },
		{ t: at(11, 3), counts: { a: 14, b: 6 } },
	];
	assert.equal(changeFor(history, 'a', 30, at(11, 3, 12)), 4);
	assert.equal(changeFor(history, 'b', 30, at(11, 3, 12)), 1);
	// One day of data for `c` is not a change, it is a single point.
	assert.equal(changeFor([{ t: at(11, 3), counts: { c: 1 } }], 'c', 30, at(11, 3, 12)), null);
	assert.equal(changeFor(history, 'ghost', 30, at(11, 3, 12)), null);
});

test('mergeSamples lets our own reading win over the archive for one day', () => {
	const ours: Sample[] = [{ t: at(11, 13, 20), counts: { a: 130 } }];
	const archive: Sample[] = [
		{ t: at(11, 13, 0), counts: { a: 120, b: 9 } },
		{ t: at(11, 12, 0), counts: { a: 100 } },
	];

	const merged = mergeSamples(ours, archive);
	assert.equal(merged.length, 2);
	assert.deepEqual(merged[0], { t: at(11, 12), counts: { a: 100 } });
	// Ours was read at a known moment; the commit is the bot's own timestamp.
	assert.deepEqual(merged[1], { t: at(11, 13), counts: { a: 130, b: 9 } });
});

test('sparkOf fits a rising series into the box, bottom to top', () => {
	const spark = sparkOf([10, 20, 30], 300, 56, 5);
	assert.ok(spark);

	// pad 5 → the band is 5..51, so the smallest value sits on the floor.
	assert.equal(spark.line, 'M0,51 L150,28 L300,5');
	assert.equal(spark.area, 'M0,51 L150,28 L300,5 L300,56 L0,56 Z');
	assert.deepEqual(spark.last, { x: 300, y: 5 });
	assert.equal(spark.min, 10);
	assert.equal(spark.max, 30);
});

test('sparkOf draws a flat series through the middle, not along the floor', () => {
	// Along the floor a steady plugin would read as "nothing", which is the
	// one thing it is not.
	const spark = sparkOf([7, 7, 7], 300, 56, 5);
	assert.equal(spark?.line, 'M0,28 L150,28 L300,28');
	assert.equal(spark?.last.y, 28);
});

test('sparkOf has nothing to draw for an empty series', () => {
	assert.equal(sparkOf([], 300, 56), null);
});

test('sparkOf puts a single point in the middle', () => {
	const spark = sparkOf([5], 300, 56, 5);
	assert.equal(spark?.line, 'M150,28');
	assert.deepEqual(spark?.last, { x: 150, y: 28 });
});

test('readCommits reads the date out of GitHub’s listing', () => {
	const commits = [
		{ sha: 'c3', commit: { committer: { date: '2026-11-14T00:14:00Z' } } },
		{ sha: 'c2', commit: { committer: { date: '2026-11-14T00:10:00Z' } } },
		{ sha: 'c1', commit: { committer: { date: '2026-11-13T00:15:00Z' } } },
		{ sha: 'nested-junk', commit: { committer: {} } },
		{ commit: { committer: { date: '2026-11-12T00:15:00Z' } } },
		'nope',
	];

	const refs = readCommits(commits);
	assert.equal(refs.length, 3);
	assert.equal(refs[0]?.sha, 'c3');
	assert.equal(refs[0]?.t, Date.parse('2026-11-14T00:14:00Z'));
	assert.deepEqual(readCommits(null), []);
	assert.deepEqual(readCommits({}), []);
});

test('pickDailyCommits takes the last commit of each day, newest first', () => {
	const commits = readCommits([
		{ sha: 'c3', commit: { committer: { date: '2026-11-14T00:14:00Z' } } },
		{ sha: 'c2', commit: { committer: { date: '2026-11-14T00:10:00Z' } } },
		{ sha: 'c1', commit: { committer: { date: '2026-11-13T00:15:00Z' } } },
	]);

	// The listing is newest-first, so the first commit seen for a day is the
	// one closest to midnight — the reading the day actually publishes.
	assert.deepEqual(
		pickDailyCommits(commits, 30).map((commit) => commit.sha),
		['c3', 'c1'],
	);
	assert.deepEqual(
		pickDailyCommits(commits, 1).map((commit) => commit.sha),
		['c3'],
	);
	assert.deepEqual(pickDailyCommits([], 30), []);
});
