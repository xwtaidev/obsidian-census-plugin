#!/usr/bin/env node
/**
 * Unit tests, no test framework.
 *
 * `node:test` ships with Node and esbuild is already a dependency, so the
 * runner is just "bundle every *.test.ts, then spawn node --test". The bundle
 * runs outside Obsidian, which is exactly what we want for the stats layer:
 * parsing and formatting a public JSON file should not need the app to prove.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function findTests(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...findTests(path));
		} else if (entry.name.endsWith('.test.ts')) {
			found.push(path);
		}
	}
	return found;
}

const tests = findTests(SRC);
if (tests.length === 0) {
	console.error('No *.test.ts files found.');
	process.exit(1);
}

const outdir = mkdtempSync(join(tmpdir(), 'census-tests-'));
try {
	await build({
		entryPoints: tests,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node20',
		outdir,
		outExtension: { '.js': '.mjs' },
		external: ['obsidian'],
		logLevel: 'warning',
	});

	const files = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith('.mjs')) files.push(path);
		}
	};
	walk(outdir);
	if (files.length === 0) {
		console.error('esbuild produced no test bundles.');
		process.exit(1);
	}

	const result = spawnSync(process.execPath, ['--test', ...files], {
		stdio: 'inherit',
	});
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(outdir, { recursive: true, force: true });
}
