import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readIndex, readInfo, repoUrl } from './registry';

const payload = [
	{
		id: 'weekly-schedule',
		name: 'Weekly Schedule',
		author: 'xwtaidev',
		description: 'Calendars.',
		repo: 'xwtaidev/obsidian-weekly-schedule-plugin',
	},
	{ id: 'coffer', name: 'Coffer', author: 'chauduyphanvu', repo: 'chauduyphanvu/obsidian-coffer' },
	{ id: 'someone-else', name: 'Not Ours', repo: 'a/b' },
];

test('readIndex keeps only the ids we track', () => {
	const info = readIndex(payload, ['weekly-schedule', 'coffer']);
	assert.deepEqual(Object.keys(info).sort(), ['coffer', 'weekly-schedule']);
	assert.equal(info['coffer']?.repo, 'chauduyphanvu/obsidian-coffer');
	assert.equal(info['coffer']?.name, 'Coffer');
});

test('readIndex drops a repository that is not owner/name', () => {
	// A URL, a bare name or a trailing slash would make a broken link look
	// like a working one.
	const info = readIndex(
		[
			{ id: 'a', repo: 'https://github.com/x/y' },
			{ id: 'b', repo: 'justaname' },
			{ id: 'c', repo: 'owner/name/' },
			{ id: 'd', repo: 'owner/name' },
		],
		['a', 'b', 'c', 'd'],
	);

	assert.equal(info['a'], undefined);
	assert.equal(info['b'], undefined);
	assert.equal(info['c'], undefined);
	assert.equal(info['d']?.repo, 'owner/name');
});

test('readIndex keeps a name even when there is no repository', () => {
	const info = readIndex([{ id: 'a', name: '  Spaced Name  ' }], ['a']);
	assert.deepEqual(info['a'], { name: 'Spaced Name' });
});

test('readIndex survives a payload that is not a list', () => {
	assert.deepEqual(readIndex(null, ['a']), {});
	assert.deepEqual(readIndex({ a: { repo: 'x/y' } }, ['a']), {});
	assert.deepEqual(readIndex([null, 3, 'x'], ['a']), {});
});

test('readInfo reads the stored map and drops junk', () => {
	const stored = {
		a: { repo: 'owner/name', name: 'A' },
		b: { repo: 'not a repo' },
		c: 'nope',
		d: { repo: 'x/y' },
	};

	assert.deepEqual(readInfo(stored, ['a', 'b', 'c']), { a: { repo: 'owner/name', name: 'A' } });
	// Without an id list nothing is filtered out.
	assert.deepEqual(Object.keys(readInfo(stored)).sort(), ['a', 'd']);
	assert.deepEqual(readInfo(null), {});
	assert.deepEqual(readInfo([]), {});
});

test('repoUrl is null when there is nothing to open', () => {
	assert.equal(repoUrl('owner/name'), 'https://github.com/owner/name');
	assert.equal(repoUrl(undefined), null);
});
