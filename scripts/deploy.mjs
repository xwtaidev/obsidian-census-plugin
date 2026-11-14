#!/usr/bin/env node
/**
 * Copies the built plugin into a vault.
 *
 * Usage:
 *   node scripts/deploy.mjs <vault-path> [plugin-folder-name]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const vault = process.argv[2];
if (!vault) {
	console.error('Usage: node scripts/deploy.mjs <vault-path> [plugin-folder-name]');
	console.error('Example: node scripts/deploy.mjs ./dev-vault timeblock');
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const folder = process.argv[3] ?? manifest.id;
const target = join(resolve(vault), '.obsidian', 'plugins', folder);

if (!existsSync(join(resolve(vault), '.obsidian'))) {
	console.error(`Not an Obsidian vault (no .obsidian directory): ${resolve(vault)}`);
	process.exit(1);
}

if (!existsSync(join(ROOT, 'main.js'))) {
	console.error('main.js is missing. Run `npm run build` first.');
	process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of FILES) {
	copyFileSync(join(ROOT, file), join(target, file));
	console.log(`copied ${file} -> ${target}`);
}

console.log(`\nReload Obsidian (or disable/enable the plugin) to pick up the build.`);
