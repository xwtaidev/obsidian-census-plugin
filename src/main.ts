import { Notice, Plugin, requestUrl } from 'obsidian';
import {
	COMMITS_API,
	HISTORY_DAYS,
	HISTORY_MAX_SAMPLES,
	INFO_TTL_MS,
	PLUGINS_INDEX_URL,
	STATS_AT_URL,
	STATS_URL,
	STATUS_BAR_CLASS,
	VIEW_TYPE_CENSUS,
} from './constants';
import { Lang, detectLang, t } from './i18n';
import { CensusSettingTab, CensusSettings, DEFAULT_SETTINGS } from './settings';
import { CensusView } from './view';
import {
	Sample,
	mergeSamples,
	pickDailyCommits,
	readCommits,
	readHistory,
	recordSample,
	trimSamples,
} from './history';
import { PluginInfo, readIndex, readInfo } from './registry';
import {
	Entry,
	Snapshot,
	countsOf,
	coversIds,
	formatCompact,
	formatFull,
	formatWhen,
	isStale,
	normalizeId,
	normalizeList,
	readMany,
	toEpochMs,
	totalDownloads,
} from './stats';

/** What single-target builds wrote. Kept only so an upgrade loses nothing. */
interface LegacyData {
	targetId?: string;
	reading?: { id: string; downloads: number; fetchedAt: number; publishedAt?: number } | null;
}

interface StoredData extends LegacyData, Partial<CensusSettings> {
	snapshot?: Snapshot;
	history?: Sample[];
	/** The tracked ids' index entries, kept small on purpose. */
	info?: Record<string, PluginInfo>;
	infoFetchedAt?: number;
	/** Which ids the index has already been asked about, published or not. */
	infoChecked?: string[];
}

/** Long enough that the daily file is never missed, short enough to be free. */
const TICK_MS = 30 * 60 * 1000;

export default class CensusPlugin extends Plugin {
	settings: CensusSettings = { ...DEFAULT_SETTINGS, targets: [] };
	/** Last fetch, shared by every tracked plugin. Null until the first success. */
	snapshot: Snapshot | null = null;
	lang: Lang = detectLang();

	/** One point per UTC day, oldest first. The panel's curve reads this. */
	history: Sample[] = [];
	/** Directory entries for the tracked ids: repository, display name. */
	info: Record<string, PluginInfo> = {};

	/** True while a backfill is walking the file's commits. */
	backfilling = false;
	backfillDone = 0;
	backfillTotal = 0;

	private statusBar: HTMLElement | null = null;
	private refreshing = false;
	/** A refresh asked for while one was in flight. Null means nothing is queued. */
	private queued: boolean | null = null;
	private indexFetchedAt = 0;
	private indexChecked: string[] = [];
	/** Writes are serialised: a check and an index fetch can land together. */
	private saveQueue: Promise<void> = Promise.resolve();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncStatusBar();
		this.registerView(VIEW_TYPE_CENSUS, (leaf) => new CensusView(leaf, this));

		this.addRibbonIcon('users', t(this.lang, 'ribbonOpen'), () => void this.activateView());

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
		// whether a check is worth the 2.5 MB file.
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
			targets: normalizeList(raw.targets ?? legacyIds),
			showInStatusBar:
				typeof raw.showInStatusBar === 'boolean'
					? raw.showInStatusBar
					: DEFAULT_SETTINGS.showInStatusBar,
			refreshHours:
				typeof raw.refreshHours === 'number' ? raw.refreshHours : DEFAULT_SETTINGS.refreshHours,
		};

		this.snapshot = this.readSnapshot(raw);
		this.history = readHistory(raw.history);
		this.info = readInfo(raw.info, this.settings.targets);
		this.indexFetchedAt = typeof raw.infoFetchedAt === 'number' ? raw.infoFetchedAt : 0;
		this.indexChecked = Array.isArray(raw.infoChecked)
			? raw.infoChecked.filter((id): id is string => typeof id === 'string')
			: [];
	}

	/** Reads the saved snapshot, translating either on-disk shape to the new one. */
	private readSnapshot(raw: StoredData): Snapshot | null {
		const entries: Record<string, Entry> = {};

		if (raw.snapshot && typeof raw.snapshot.fetchedAt === 'number') {
			for (const [id, entry] of Object.entries(raw.snapshot.entries ?? {})) {
				if (typeof entry?.downloads !== 'number') continue;
				entries[id] = {
					downloads: entry.downloads,
					publishedAt:
						typeof entry.publishedAt === 'number' ? toEpochMs(entry.publishedAt) : undefined,
				};
			}
			return {
				fetchedAt: raw.snapshot.fetchedAt,
				entries,
				// Snapshots from before this field existed fall back to the keys
				// they happen to have, which is the best answer available.
				checkedIds: Array.isArray(raw.snapshot.checkedIds)
					? raw.snapshot.checkedIds
					: Object.keys(entries),
			};
		}

		// Pre-list builds: one reading, one id.
		if (raw.reading && typeof raw.reading.downloads === 'number') {
			const id = normalizeId(raw.reading.id);
			if (id) {
				entries[id] = {
					downloads: raw.reading.downloads,
					publishedAt:
						typeof raw.reading.publishedAt === 'number'
							? toEpochMs(raw.reading.publishedAt)
							: undefined,
				};
				return { fetchedAt: raw.reading.fetchedAt ?? 0, entries, checkedIds: [id] };
			}
		}

		return null;
	}

	async saveSettings(): Promise<void> {
		const data: StoredData = {
			targets: this.settings.targets,
			showInStatusBar: this.settings.showInStatusBar,
			refreshHours: this.settings.refreshHours,
			snapshot: this.snapshot ?? undefined,
			history: this.history,
			info: this.info,
			infoFetchedAt: this.indexFetchedAt,
			infoChecked: this.indexChecked,
		};

		// One write at a time. Each `data` is built from the fields as they are
		// now, so the later call wins with a complete picture rather than the
		// two of them interleaving into a half-written file.
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(data));
		await this.saveQueue;
	}

	/** The tracked ids, normalised. A single source of truth for every caller. */
	targetIds(): string[] {
		return normalizeList(this.settings.targets);
	}

	get busy(): boolean {
		return this.refreshing;
	}

	/** Adds an id. Returns false when it was already there or blank. */
	async addTarget(raw: string): Promise<boolean> {
		const id = normalizeId(raw);
		if (!id) return false;

		const ids = this.targetIds();
		if (ids.includes(id)) return false;

		this.settings.targets = [...ids, id];
		await this.saveSettings();
		this.applySettings();
		return true;
	}

	async removeTarget(id: string): Promise<void> {
		this.settings.targets = this.targetIds().filter((item) => item !== id);
		await this.saveSettings();
		this.applySettings();
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
	 * Fetches when there is nothing cached, when a tracked id is not in the
	 * cache, or when the cache is older than the configured trust window.
	 * One request covers the whole list, which is why a list costs no more
	 * than a single plugin did.
	 */
	async refresh(force: boolean): Promise<Snapshot | null> {
		const ids = this.targetIds();
		if (!ids.length) {
			if (force) new Notice(t(this.lang, 'noTarget'));
			return null;
		}

		if (this.refreshing) {
			// An id added mid-flight would otherwise be fetched-then-forgotten:
			// the in-flight result was built from the older list. Queue it.
			this.queued = (this.queued ?? false) || force;
			return this.snapshot;
		}

		if (
			!force &&
			coversIds(this.snapshot, ids) &&
			!isStale(this.snapshot?.fetchedAt, this.settings.refreshHours, Date.now())
		) {
			return this.snapshot;
		}

		this.refreshing = true;
		this.statusBar?.addClass('is-busy');
		// The panel says "checking" while the old numbers stay put, which is
		// honest about both facts at once.
		this.refreshViews();

		try {
			const response = await requestUrl({ url: STATS_URL, method: 'GET', throw: false });
			if (response.status < 200 || response.status >= 300) {
				throw new Error(`HTTP ${response.status}`);
			}

			const entries = readMany(response.json, ids);
			const fetchedAt = Date.now();
			this.snapshot = { fetchedAt, entries, checkedIds: ids };
			// The curve is built from these readings, one per day. Reading the
			// same day twice replaces that day's point instead of adding one.
			this.history = recordSample(this.history, fetchedAt, countsOf(entries), HISTORY_MAX_SAMPLES);
			await this.saveSettings();

			const missing = ids.filter((id) => !entries[id]);
			if (missing.length) {
				new Notice(t(this.lang, 'someNotListed', { ids: missing.join(', ') }), 8000);
			}

			// The repository map is a second, much rarer request; the numbers
			// should not wait for it.
			void this.ensureInfo();
			return this.snapshot;
		} catch (error) {
			// A failed check is not a reason to lose the last numbers.
			console.error('[census] could not read the stats file', error);
			new Notice(t(this.lang, 'networkFailed'), 8000);
			return this.snapshot;
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

	/**
	 * Reads the directory index when a tracked id has never been looked up, or
	 * when the last look is older than a week.
	 *
	 * A plugin that is not published yet will never appear, so "asked, did not
	 * find" is remembered. Without that, every check would re-download 3.2 MB
	 * to confirm the same absence.
	 */
	private async ensureInfo(): Promise<void> {
		const ids = this.targetIds();
		if (!this.needsInfo(ids)) return;

		try {
			const response = await requestUrl({ url: PLUGINS_INDEX_URL, method: 'GET', throw: false });
			if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

			const found = readIndex(response.json, ids);
			const kept: Record<string, PluginInfo> = {};
			for (const id of ids) {
				const info = found[id] ?? this.info[id];
				if (info) kept[id] = info;
			}

			this.info = kept;
			this.indexChecked = ids;
			this.indexFetchedAt = Date.now();
			await this.saveSettings();
			this.refreshViews();
		} catch (error) {
			// A missing repository costs a link and nothing else, so this stays
			// out of the user's way.
			console.error('[census] could not read the plugin index', error);
		}
	}

	private needsInfo(ids: string[]): boolean {
		if (!ids.length) return false;
		if (ids.some((id) => !this.indexChecked.includes(id))) return true;
		return Date.now() - this.indexFetchedAt > INFO_TTL_MS;
	}

	/**
	 * Fills the curve from the stats file's own commits: one request for the
	 * commit list, then one per day.
	 *
	 * It is the only way to draw a month of history for a plugin installed
	 * today, which is why it is offered rather than performed: thirty requests
	 * of a few megabytes is not something to do behind the user's back.
	 */
	async backfill(days = HISTORY_DAYS): Promise<void> {
		const ids = this.targetIds();
		if (!ids.length || this.backfilling) return;

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
							url: `${STATS_AT_URL}${commit.sha}/community-plugin-stats.json`,
							method: 'GET',
							throw: false,
						});
						if (day.status >= 200 && day.status < 300) {
							const entries = readMany(day.json, ids);
							if (Object.keys(entries).length) {
								collected.push({ t: commit.t, counts: countsOf(entries) });
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

	/** Drops the curve, not the numbers: the snapshot is still the last reading. */
	async clearHistory(): Promise<void> {
		this.history = [];
		await this.saveSettings();
		this.refreshViews();
	}

	private async announce(): Promise<void> {
		const ids = this.targetIds();
		if (!ids.length) {
			new Notice(t(this.lang, 'noTarget'));
			return;
		}

		const snapshot = await this.refresh(false);
		// On failure, `refresh` has already said so.
		if (!snapshot) return;

		if (ids.length === 1) {
			const id = ids[0];
			if (!id) return;
			const entry = snapshot.entries[id];
			if (!entry) {
				new Notice(t(this.lang, 'notListed', { id }), 8000);
				return;
			}
			const head = t(this.lang, 'reading', { name: id, count: formatFull(entry.downloads) });
			const tail = t(this.lang, 'readingMeta', {
				checked: formatWhen(snapshot.fetchedAt),
				published: entry.publishedAt
					? t(this.lang, 'publishedSuffix', { date: formatWhen(entry.publishedAt) })
					: '',
			});
			new Notice(`${head}\n${tail}`, 8000);
			return;
		}

		const head = t(this.lang, 'readingMany', {
			count: String(ids.length),
			total: formatFull(totalDownloads(snapshot, ids)),
		});
		const lines = ids.map((id) => {
			const entry = snapshot.entries[id];
			return `${id}  ${entry ? formatFull(entry.downloads) : t(this.lang, 'notListedShort')}`;
		});
		const tail = t(this.lang, 'checkedAt', { when: formatWhen(snapshot.fetchedAt) });
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

		const ids = this.targetIds();
		if (!ids.length) {
			this.statusBar.setText(t(this.lang, 'statusIdle'));
			this.statusBar.setAttr('aria-label', t(this.lang, 'noTarget'));
			return;
		}

		if (ids.length === 1) {
			const id = ids[0];
			if (!id) return;
			const entry = this.snapshot?.entries[id];
			this.statusBar.setText(
				entry ? `${id} · ${formatCompact(entry.downloads)}` : `${id} · ${t(this.lang, 'unknown')}`,
			);
			this.statusBar.setAttr(
				'aria-label',
				entry
					? t(this.lang, 'statusTooltip', { name: id, count: formatFull(entry.downloads) })
					: t(this.lang, 'statusIdle'),
			);
			return;
		}

		// Several plugins do not fit in a status bar, so it shows the total and
		// leaves the per-plugin detail to the tooltip and the panel.
		const known = ids.filter((id) => this.snapshot?.entries[id]);
		if (!known.length) {
			this.statusBar.setText(`Census · ${t(this.lang, 'unknown')}`);
			this.statusBar.setAttr('aria-label', t(this.lang, 'statusIdle'));
			return;
		}

		const total = totalDownloads(this.snapshot, ids);
		this.statusBar.setText(`Census · ${formatCompact(total)}`);
		this.statusBar.setAttr(
			'aria-label',
			t(this.lang, 'statusManyTooltip', {
				count: String(ids.length),
				total: formatFull(total),
				list: ids
					.map(
						(id) =>
							`${id} ${this.snapshot?.entries[id] ? formatFull(this.snapshot.entries[id].downloads) : '—'}`,
					)
					.join(' · '),
			}),
		);
	}
}
