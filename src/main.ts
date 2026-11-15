import { Notice, Plugin, requestUrl } from 'obsidian';
import {
	COMMITS_API,
	HISTORY_DAYS,
	HISTORY_MAX_SAMPLES,
	INFO_TTL_MS,
	PLUGIN_INDEX_URL,
	PLUGIN_STATS_FILE,
	PLUGIN_STATS_URL,
	STATS_AT_URL,
	STATUS_BAR_CLASS,
	THEME_INDEX_URL,
	THEME_STATS_URL,
	VIEW_TYPE_CENSUS,
} from './constants';
import { Lang, detectLang, t } from './i18n';
import { CensusSettingTab, CensusSettings, DEFAULT_SETTINGS } from './settings';
import { CensusView } from './view';
import {
	Sample,
	mergeSamples,
	migrateKeys,
	pickDailyCommits,
	readCommits,
	readHistory,
	recordSample,
	trimSamples,
} from './history';
import { TargetInfo, readIndex, readInfo, readThemeIndex } from './registry';
import {
	Entry,
	Kind,
	Snapshot,
	Target,
	countsOf,
	coversIds,
	formatCompact,
	formatFull,
	formatWhen,
	isStale,
	keyOf,
	normalizeId,
	normalizePluginList,
	normalizeThemeList,
	normalizeThemeName,
	readMany,
	toEpochMs,
	totalDownloads,
} from './stats';

/** What single-target builds wrote. Kept only so an upgrade loses nothing. */
interface LegacyData {
	targetId?: string;
	reading?: { id: string; downloads: number; fetchedAt: number; publishedAt?: number } | null;
}

/** Everything one directory keeps between launches. */
interface SourceState {
	snapshot: Snapshot | null;
	/** Directory entries for the tracked ids: repository, display name. */
	info: Record<string, TargetInfo>;
	infoFetchedAt: number;
	/** Which ids the index has already been asked about, published or not. */
	infoChecked: string[];
}

function emptyState(): SourceState {
	return { snapshot: null, info: {}, infoFetchedAt: 0, infoChecked: [] };
}

interface StoredData extends LegacyData, Partial<CensusSettings> {
	plugins?: Partial<SourceState>;
	themes?: Partial<SourceState>;
	history?: Sample[];
	/** Pre-theme builds kept the plugin directory at the top level. */
	snapshot?: Snapshot;
	info?: Record<string, TargetInfo>;
	infoFetchedAt?: number;
	infoChecked?: string[];
}

/**
 * One directory: where its numbers come from, and where its index lives.
 *
 * The two differ in exactly one respect that matters here — plugins have a
 * committed stats file whose own commits are a daily log, themes have a live
 * endpoint and no history at all. Everything else is the same shape.
 */
interface Source {
	statsUrl: string;
	indexUrl: string;
	/** The file behind `statsUrl`, when there is one. Only then is backfill possible. */
	statsFile?: string;
}

const SOURCES: Record<Kind, Source> = {
	plugin: {
		statsUrl: PLUGIN_STATS_URL,
		indexUrl: PLUGIN_INDEX_URL,
		statsFile: PLUGIN_STATS_FILE,
	},
	theme: { statsUrl: THEME_STATS_URL, indexUrl: THEME_INDEX_URL },
};

const KINDS: readonly Kind[] = ['plugin', 'theme'];

/** Long enough that the daily file is never missed, short enough to be free. */
const TICK_MS = 30 * 60 * 1000;

export default class CensusPlugin extends Plugin {
	settings: CensusSettings = { ...DEFAULT_SETTINGS, targets: [], themeTargets: [] };
	lang: Lang = detectLang();

	/** One reading and one index per directory: they have separate lifecycles. */
	state: Record<Kind, SourceState> = { plugin: emptyState(), theme: emptyState() };

	/** One point per UTC day, oldest first. The panel's curve reads this. */
	history: Sample[] = [];

	/** True while a backfill is walking the stats file's commits. */
	backfilling = false;
	backfillDone = 0;
	backfillTotal = 0;

	private statusBar: HTMLElement | null = null;
	private refreshing = false;
	/** A refresh asked for while one was in flight. Null means nothing is queued. */
	private queued: boolean | null = null;
	/** Writes are serialised: two sources and a settings change can land together. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncStatusBar();
		this.registerView(VIEW_TYPE_CENSUS, (leaf) => new CensusView(leaf, this));

		// A chart mark, not `users`: the number on the panel is installs and
		// updates, and two little figures in the ribbon would promise a
		// headcount this plugin explicitly does not measure.
		this.addRibbonIcon('chart-line', t(this.lang, 'ribbonOpen'), () => void this.activateView());

		this.addCommand({
			id: 'show-download-count',
			name: t(this.lang, 'commandShow'),
			callback: () => {
				void this.announce();
			},
		});

		this.addCommand({
			id: 'refresh-download-count',
			name: t(this.lang, 'commandRefresh'),
			callback: () => {
				void this.refresh(true);
			},
		});

		this.addCommand({
			id: 'open-reading-panel',
			name: t(this.lang, 'commandOpenPanel'),
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new CensusSettingTab(this.app, this));

		// The totals move once a day. This tick only nudges; `isStale` decides
		// whether a check is worth the bytes.
		this.registerInterval(window.setInterval(() => void this.refresh(false), TICK_MS));
		this.app.workspace.onLayoutReady(() => void this.refresh(false));
	}

	onunload(): void {
		this.statusBar?.remove();
		this.statusBar = null;
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) as StoredData | null) ?? {};
		const legacyIds = raw.targetId ? [raw.targetId] : [];

		this.settings = {
			targets: normalizePluginList(raw.targets ?? legacyIds),
			themeTargets: normalizeThemeList(raw.themeTargets ?? []),
			showInStatusBar:
				typeof raw.showInStatusBar === 'boolean'
					? raw.showInStatusBar
					: DEFAULT_SETTINGS.showInStatusBar,
			refreshHours:
				typeof raw.refreshHours === 'number' ? raw.refreshHours : DEFAULT_SETTINGS.refreshHours,
		};

		// A pre-theme file has the plugin directory spread across top-level keys.
		const legacyPlugins: Partial<SourceState> = {
			snapshot: raw.snapshot ?? this.fromReading(raw.reading),
			info: raw.info,
			infoFetchedAt: raw.infoFetchedAt,
			infoChecked: raw.infoChecked,
		};

		this.state = {
			plugin: this.readState(raw.plugins ?? legacyPlugins, this.settings.targets),
			theme: this.readState(raw.themes, this.settings.themeTargets),
		};
		// Readings written before themes arrived have bare plugin ids under them.
		this.history = migrateKeys(readHistory(raw.history));
	}

	/** Reads one directory's saved state, translating either on-disk shape. */
	private readState(stored: Partial<SourceState> | undefined, ids: readonly string[]): SourceState {
		return {
			snapshot: this.readSnapshot(stored?.snapshot),
			info: readInfo(stored?.info, ids),
			infoFetchedAt: typeof stored?.infoFetchedAt === 'number' ? stored.infoFetchedAt : 0,
			infoChecked: Array.isArray(stored?.infoChecked)
				? stored.infoChecked.filter((id): id is string => typeof id === 'string')
				: [],
		};
	}

	/** Reads a saved snapshot, normalising the timestamp unit it was written in. */
	private readSnapshot(value: unknown): Snapshot | null {
		if (!value || typeof value !== 'object') return null;
		const raw = value as Snapshot;
		if (typeof raw.fetchedAt !== 'number') return null;

		const entries: Record<string, Entry> = {};
		for (const [id, entry] of Object.entries(raw.entries ?? {})) {
			if (typeof entry?.downloads !== 'number') continue;
			entries[id] = {
				downloads: entry.downloads,
				publishedAt:
					typeof entry.publishedAt === 'number' ? toEpochMs(entry.publishedAt) : undefined,
			};
		}

		return {
			fetchedAt: raw.fetchedAt,
			entries,
			// Snapshots from before this field existed fall back to the keys
			// they happen to have, which is the best answer available.
			checkedIds: Array.isArray(raw.checkedIds) ? raw.checkedIds : Object.keys(entries),
		};
	}

	/** A pre-list build kept one reading, for one id. */
	private fromReading(reading: LegacyData['reading']): Snapshot | null {
		if (!reading || typeof reading.downloads !== 'number') return null;
		const id = normalizeId(reading.id);
		if (!id) return null;

		return {
			fetchedAt: typeof reading.fetchedAt === 'number' ? reading.fetchedAt : 0,
			entries: {
				[id]: {
					downloads: reading.downloads,
					publishedAt: typeof reading.publishedAt === 'number' ? toEpochMs(reading.publishedAt) : undefined,
				},
			},
			checkedIds: [id],
		};
	}

	async saveSettings(): Promise<void> {
		const data: StoredData = {
			targets: this.settings.targets,
			themeTargets: this.settings.themeTargets,
			showInStatusBar: this.settings.showInStatusBar,
			refreshHours: this.settings.refreshHours,
			plugins: this.state.plugin,
			themes: this.state.theme,
			history: this.history,
		};

		// One write at a time. Each `data` is built from the fields as they are
		// now, so the later call wins with a complete picture rather than the
		// two of them interleaving into a half-written file.
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(data));
		await this.saveQueue;
	}

	/** The tracked ids of one directory, normalised. A single source of truth. */
	targetsOf(kind: Kind): string[] {
		return kind === 'theme'
			? normalizeThemeList(this.settings.themeTargets)
			: normalizePluginList(this.settings.targets);
	}

	/** Every tracked target, plugins first — the order the panel draws them in. */
	allTargets(): Target[] {
		const out: Target[] = [];
		for (const kind of KINDS) {
			for (const id of this.targetsOf(kind)) out.push({ kind, id });
		}
		return out;
	}

	/** The directories that currently have something to read. */
	activeKinds(): Kind[] {
		return KINDS.filter((kind) => this.targetsOf(kind).length > 0);
	}

	/** The ids of one directory as reading keys (`plugin:…`, `theme:…`). */
	keysOf(kind: Kind): string[] {
		return this.targetsOf(kind).map((id) => keyOf({ kind, id }));
	}

	snapshotOf(kind: Kind): Snapshot | null {
		return this.state[kind].snapshot;
	}

	infoOf(kind: Kind): Record<string, TargetInfo> {
		return this.state[kind].info;
	}

	get busy(): boolean {
		return this.refreshing;
	}

	/** Adds an id. Returns false when it was already there or blank. */
	async addTarget(kind: Kind, raw: string): Promise<boolean> {
		// Themes are keyed by display name, so they keep their capitals; plugin
		// ids are folder names and have none to keep.
		const id = kind === 'theme' ? normalizeThemeName(raw) : normalizeId(raw);
		if (!id) return false;

		const targets = this.targetsOf(kind);
		if (targets.includes(id)) return false;

		this.setTargets(kind, [...targets, id]);
		await this.saveSettings();
		this.applySettings();
		return true;
	}

	async removeTarget(kind: Kind, id: string): Promise<void> {
		this.setTargets(
			kind,
			this.targetsOf(kind).filter((item) => item !== id),
		);
		await this.saveSettings();
		this.applySettings();
	}

	private setTargets(kind: Kind, list: string[]): void {
		if (kind === 'theme') this.settings.themeTargets = list;
		else this.settings.targets = list;
	}

	/**
	 * Called after the settings tab writes something.
	 *
	 * `refetch: false` is for a change that cannot have brought a new id in —
	 * the status bar and the panel follow along without touching the network.
	 */
	applySettings(options: { refetch?: boolean } = {}): void {
		this.syncStatusBar();
		this.refreshViews();
		if (options.refetch !== false) void this.refresh(false);
	}

	/**
	 * Opens the readout as a right-sidebar tab, or focuses it when the layout
	 * already has one — reopening it elsewhere would leave two copies of the
	 * same numbers on screen.
	 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_CENSUS)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_CENSUS, active: true });
		}

		await workspace.revealLeaf(leaf);
		void this.refresh(false);
	}

	/** `app.setting` is not in the typings, but it ships with every build. */
	openSettings(): void {
		const setting = (this.app as unknown as {
			setting?: { open(): void; openTabById(id: string): void };
		}).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	/** Redraws every open panel; a no-op when the user never opened one. */
	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CENSUS)) {
			if (leaf.view instanceof CensusView) leaf.view.render();
		}
	}

	/**
	 * Fetches the directories that need it: nothing cached, an id the cache
	 * never asked about, or a cache older than the configured trust window.
	 * One request per directory covers the whole list.
	 */
	async refresh(force: boolean): Promise<void> {
		const kinds = this.activeKinds();
		if (!kinds.length) {
			if (force) new Notice(t(this.lang, 'noTarget'));
			return;
		}

		if (this.refreshing) {
			// An id added mid-flight would otherwise be fetched-then-forgotten:
			// the in-flight result was built from the older list. Queue it.
			this.queued = (this.queued ?? false) || force;
			return;
		}

		const due = kinds.filter((kind) => force || this.needsFetch(kind));
		if (!due.length) return;

		this.refreshing = true;
		this.statusBar?.addClass('is-busy');
		// The panel says "checking" while the old numbers stay put, which is
		// honest about both facts at once.
		this.refreshViews();

		try {
			const results = await Promise.all(
				due.map(async (kind) => ({ kind, result: await this.fetchKind(kind) })),
			);

			// One writing of the day's point, after both requests are in: two
			// samples for one day would claim the panel samples more often than
			// it does, and interleaved writes would drop one of them.
			const counts: Record<string, number> = {};
			let fetchedAt = Number.POSITIVE_INFINITY;
			const missing: string[] = [];
			let failed = false;

			for (const { result } of results) {
				if (!result) {
					failed = true;
					continue;
				}
				Object.assign(counts, result.counts);
				fetchedAt = Math.min(fetchedAt, result.fetchedAt);
				missing.push(...result.missing);
			}

			if (Number.isFinite(fetchedAt)) {
				this.history = recordSample(this.history, fetchedAt, counts, HISTORY_MAX_SAMPLES);
			}
			await this.saveSettings();

			if (missing.length) {
				new Notice(t(this.lang, 'someNotListed', { ids: missing.join(', ') }), 8000);
			}
			if (failed) new Notice(t(this.lang, 'networkFailed'), 8000);

			// The repository maps are second, much rarer requests; the numbers
			// should not wait for them.
			for (const kind of due) void this.ensureInfo(kind);
		} finally {
			this.refreshing = false;
			this.statusBar?.removeClass('is-busy');
			this.syncStatusBar();
			this.refreshViews();

			// Whatever arrived while this request was out is asked for now, once.
			if (this.queued !== null) {
				const forceNext = this.queued;
				this.queued = null;
				void this.refresh(forceNext);
			}
		}
	}

	private needsFetch(kind: Kind): boolean {
		const ids = this.targetsOf(kind);
		if (!ids.length) return false;

		const { snapshot } = this.state[kind];
		return !coversIds(snapshot, ids) || isStale(snapshot?.fetchedAt, this.settings.refreshHours, Date.now());
	}

	/**
	 * One directory's numbers, filed under keys the shared series can hold.
	 * Null when the request failed: a failed check is not a reason to lose the
	 * last numbers, only to say so.
	 */
	private async fetchKind(
		kind: Kind,
	): Promise<{ counts: Record<string, number>; fetchedAt: number; missing: string[] } | null> {
		const ids = this.targetsOf(kind);

		try {
			const response = await requestUrl({ url: SOURCES[kind].statsUrl, method: 'GET', throw: false });
			if (response.status < 200 || response.status >= 300) {
				throw new Error(`HTTP ${response.status}`);
			}

			const entries = readMany(response.json, ids);
			const fetchedAt = Date.now();
			this.state[kind].snapshot = { fetchedAt, entries, checkedIds: ids };

			return {
				counts: this.namespaced(kind, countsOf(entries)),
				fetchedAt,
				missing: ids.filter((id) => !entries[id]),
			};
		} catch (error) {
			console.error(`[census] could not read the ${kind} stats`, error);
			return null;
		}
	}

	/** Bare counts → the `<kind>:<id>` keys history is filed under. */
	private namespaced(kind: Kind, counts: Record<string, number>): Record<string, number> {
		const out: Record<string, number> = {};
		for (const [id, value] of Object.entries(counts)) out[keyOf({ kind, id })] = value;
		return out;
	}

	/**
	 * Reads one directory's index when a tracked id has never been looked up,
	 * or when the last look is older than a week.
	 *
	 * An entry that is not published yet will never appear, so "asked, did not
	 * find" is remembered. Without that, every check would re-download the
	 * whole index to confirm the same absence.
	 */
	private async ensureInfo(kind: Kind): Promise<void> {
		const ids = this.targetsOf(kind);
		if (!this.needsInfo(kind)) return;

		try {
			const response = await requestUrl({ url: SOURCES[kind].indexUrl, method: 'GET', throw: false });
			if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

			const found =
				kind === 'theme'
					? readThemeIndex(response.json, ids)
					: readIndex(response.json, ids);

			const state = this.state[kind];
			const kept: Record<string, TargetInfo> = {};
			for (const id of ids) {
				const info = found[id] ?? state.info[id];
				if (info) kept[id] = info;
			}

			state.info = kept;
			state.infoChecked = ids;
			state.infoFetchedAt = Date.now();
			await this.saveSettings();
			this.refreshViews();
		} catch (error) {
			// A missing repository costs a link and nothing else, so this stays
			// out of the user's way.
			console.error(`[census] could not read the ${kind} index`, error);
		}
	}

	private needsInfo(kind: Kind): boolean {
		const ids = this.targetsOf(kind);
		if (!ids.length) return false;

		const { infoChecked, infoFetchedAt } = this.state[kind];
		if (ids.some((id) => !infoChecked.includes(id))) return true;
		return Date.now() - infoFetchedAt > INFO_TTL_MS;
	}

	/**
	 * Fills the curve from the stats file's own commits: one request for the
	 * commit list, then one per day.
	 *
	 * It is the only way to draw a month of history for a plugin installed
	 * today, which is why it is offered rather than performed: thirty requests
	 * of a few megabytes is not something to do behind the user's back.
	 *
	 * Themes are out of reach here — their numbers come from a live endpoint
	 * with no commits behind it — so this reads plugin targets only.
	 */
	async backfill(days = HISTORY_DAYS): Promise<void> {
		const ids = this.targetsOf('plugin');
		if (!ids.length) {
			new Notice(t(this.lang, 'backfillNoPlugins'), 8000);
			return;
		}
		if (this.backfilling) return;

		this.backfilling = true;
		this.backfillDone = 0;
		this.backfillTotal = 0;
		this.refreshViews();

		try {
			const list = await requestUrl({
				url: `${COMMITS_API}${Math.min(days + 2, 100)}`,
				method: 'GET',
				throw: false,
			});
			if (list.status < 200 || list.status >= 300) throw new Error(`HTTP ${list.status}`);

			const plan = pickDailyCommits(readCommits(list.json), days);
			this.backfillTotal = plan.length;
			this.refreshViews();

			const queue = [...plan];
			const collected: Sample[] = [];

			// Three at a time: each response is a few megabytes. GitHub is
			// generous about this, but not that generous.
			const worker = async (): Promise<void> => {
				for (;;) {
					const commit = queue.shift();
					if (!commit) return;

					try {
						const day = await requestUrl({
							url: `${STATS_AT_URL}${commit.sha}/${PLUGIN_STATS_FILE}`,
							method: 'GET',
							throw: false,
						});
						if (day.status >= 200 && day.status < 300) {
							const entries = readMany(day.json, ids);
							if (Object.keys(entries).length) {
								collected.push({
									t: commit.t,
									counts: this.namespaced('plugin', countsOf(entries)),
								});
							}
						}
					} catch (error) {
						// One unreadable day out of thirty is no reason to throw
						// away the other twenty-nine.
						console.error('[census] could not read a past day', commit.sha, error);
					}

					this.backfillDone += 1;
					this.refreshViews();
				}
			};

			await Promise.all([worker(), worker(), worker()]);
			if (!collected.length) throw new Error('no days could be read');

			// Days we sampled ourselves win over the same day from the archive:
			// ours were read at a known moment, a commit's date is the bot's.
			this.history = trimSamples(mergeSamples(this.history, collected), HISTORY_MAX_SAMPLES);
			await this.saveSettings();
			new Notice(t(this.lang, 'backfillDone', { count: String(collected.length) }), 6000);
		} catch (error) {
			console.error('[census] backfill failed', error);
			new Notice(t(this.lang, 'backfillFailed'), 8000);
		} finally {
			this.backfilling = false;
			this.backfillTotal = 0;
			this.refreshViews();
		}
	}

	/** Drops the curve, not the numbers: the snapshots are still the last reading. */
	async clearHistory(): Promise<void> {
		this.history = [];
		await this.saveSettings();
		this.refreshViews();
	}

	/** The oldest reading on screen: with two sources, freshness is the worst one. */
	oldestFetchedAt(): number | null {
		let oldest: number | null = null;
		for (const kind of this.activeKinds()) {
			const { snapshot } = this.state[kind];
			if (!snapshot) continue;
			oldest = oldest === null ? snapshot.fetchedAt : Math.min(oldest, snapshot.fetchedAt);
		}
		return oldest;
	}

	/** Downloads across everything tracked; missing ids contribute nothing. */
	totalAll(): number {
		let total = 0;
		for (const kind of this.activeKinds()) {
			total += totalDownloads(this.state[kind].snapshot, this.targetsOf(kind));
		}
		return total;
	}

	/** "5 plugins" / "1 theme" / "5 plugins · 1 theme" — for the tallies. */
	summaryLabel(): string {
		const parts: string[] = [];
		const plugins = this.targetsOf('plugin').length;
		const themes = this.targetsOf('theme').length;
		if (plugins) parts.push(t(this.lang, 'countPlugins', { count: String(plugins) }));
		if (themes) parts.push(t(this.lang, 'countThemes', { count: String(themes) }));
		return parts.join(' · ');
	}

	private async announce(): Promise<void> {
		const targets = this.allTargets();
		if (!targets.length) {
			new Notice(t(this.lang, 'noTarget'));
			return;
		}

		await this.refresh(false);
		const checked = this.oldestFetchedAt();

		if (targets.length === 1) {
			const only = targets[0];
			if (!only) return;
			const entry = this.state[only.kind].snapshot?.entries[only.id];
			if (!entry) {
				new Notice(
					t(this.lang, only.kind === 'theme' ? 'notListedTheme' : 'notListed', { id: only.id }),
					8000,
				);
				return;
			}
			const head = t(this.lang, 'reading', { name: only.id, count: formatFull(entry.downloads) });
			const tail = t(this.lang, 'readingMeta', {
				checked: checked ? formatWhen(checked) : t(this.lang, 'never'),
				published: entry.publishedAt
					? t(this.lang, 'publishedSuffix', { date: formatWhen(entry.publishedAt) })
					: '',
			});
			new Notice(`${head}\n${tail}`, 8000);
			return;
		}

		const head = t(this.lang, 'readingMany', {
			summary: this.summaryLabel(),
			total: formatFull(this.totalAll()),
		});
		const lines = targets.map((target) => {
			const entry = this.state[target.kind].snapshot?.entries[target.id];
			return `${target.id}  ${entry ? formatFull(entry.downloads) : t(this.lang, 'notListedShort')}`;
		});
		const tail = t(this.lang, 'checkedAt', {
			when: checked ? formatWhen(checked) : t(this.lang, 'never'),
		});
		new Notice([head, ...lines, tail].join('\n'), 10000);
	}

	private syncStatusBar(): void {
		if (!this.settings.showInStatusBar) {
			this.statusBar?.remove();
			this.statusBar = null;
			return;
		}

		if (!this.statusBar) {
			const el = this.addStatusBarItem();
			el.addClass(STATUS_BAR_CLASS);
			this.registerDomEvent(el, 'click', () => void this.announce());
			this.statusBar = el;
		}

		const targets = this.allTargets();
		if (!targets.length) {
			this.statusBar.setText(t(this.lang, 'statusIdle'));
			this.statusBar.setAttr('aria-label', t(this.lang, 'noTarget'));
			return;
		}

		if (targets.length === 1) {
			const only = targets[0];
			if (!only) return;
			const entry = this.state[only.kind].snapshot?.entries[only.id];
			this.statusBar.setText(
				entry ? `${only.id} · ${formatCompact(entry.downloads)}` : `${only.id} · ${t(this.lang, 'unknown')}`,
			);
			this.statusBar.setAttr(
				'aria-label',
				entry
					? t(this.lang, 'statusTooltip', { name: only.id, count: formatFull(entry.downloads) })
					: t(this.lang, 'statusIdle'),
			);
			return;
		}

		// Several targets do not fit in a status bar, so it shows the total and
		// leaves the per-target detail to the tooltip and the panel.
		const known = targets.filter((target) => this.state[target.kind].snapshot?.entries[target.id]);
		if (!known.length) {
			this.statusBar.setText(`Census · ${t(this.lang, 'unknown')}`);
			this.statusBar.setAttr('aria-label', t(this.lang, 'statusIdle'));
			return;
		}

		const total = this.totalAll();
		this.statusBar.setText(`Census · ${formatCompact(total)}`);
		this.statusBar.setAttr(
			'aria-label',
			t(this.lang, 'statusManyTooltip', {
				summary: this.summaryLabel(),
				total: formatFull(total),
				list: targets
					.map((target) => {
						const entry = this.state[target.kind].snapshot?.entries[target.id];
						return `${target.id} ${entry ? formatFull(entry.downloads) : '—'}`;
					})
					.join(' · '),
			}),
		);
	}
}
