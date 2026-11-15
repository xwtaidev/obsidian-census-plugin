import { ItemView, WorkspaceLeaf } from 'obsidian';
import {
	GITHUB_MARK_BODY,
	GITHUB_MARK_VIEWBOX,
	OBSIDIAN_MARK_BODY,
	OBSIDIAN_MARK_FACET_LEFT,
	OBSIDIAN_MARK_FACET_RIGHT,
	OBSIDIAN_MARK_VIEWBOX,
} from './brand';
import { HISTORY_DAYS, PLUGIN_PAGE_URL, VIEW_TYPE_CENSUS } from './constants';
import { Change, Sample, changeFor, changeOf, sparkOf, totalOf, windowOf } from './history';
import { Lang, t } from './i18n';
import { TargetInfo, repoUrl, themePageUrl } from './registry';
import { Kind, Snapshot, formatFull, formatShortDate, formatWhen, keyOf, totalDownloads } from './stats';
import type CensusPlugin from './main';

/** The chart is drawn in this coordinate space and stretched to the column. */
const CHART_WIDTH = 300;
const CHART_HEIGHT = 56;

/** Gradient ids have to be unique per document; one render can build several. */
let chartSeq = 0;

/**
 * One directory's share of the panel: what is tracked, what was read, and the
 * index entries that turn a row into two links.
 */
interface Block {
	kind: Kind;
	ids: string[];
	snapshot: Snapshot | null;
	info: Record<string, TargetInfo>;
	/** Reading keys (`plugin:…`, `theme:…`), in the same order as `ids`. */
	keys: string[];
}

/**
 * The reading as a sidebar tab.
 *
 * The shape is a curve and a list: the curve answers "is it moving", the list
 * answers "who is moving". Above them sits one number big enough to read from
 * across the desk, which is the only reason to put this in a sidebar instead
 * of on a web page.
 *
 * Plugins and themes get one block each rather than one merged list. Their
 * numbers come from different places and only one of the two has a history to
 * backfill, so a single curve across both would show a step on the day the
 * second kind was added — the shape of a lie, not of growth.
 */
export class CensusView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: CensusPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_CENSUS;
	}

	getDisplayText(): string {
		return 'Census';
	}

	getIcon(): string {
		// The same mark as the ribbon, so the tab is recognisable as this panel.
		return 'chart-line';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('census-view');
		this.render();
		// Restored layouts open without going through `activateView`, and a
		// snapshot kept from last week is not what the panel should show.
		void this.plugin.refresh(false);
	}

	async onClose(): Promise<void> {
		// Nothing to tear down: the DOM lives in `contentEl`.
	}

	/** Idempotent, so `refresh` can call it before and after the fetch. */
	render(): void {
		const el = this.contentEl;
		el.empty();

		const lang = this.plugin.lang;
		const blocks = this.blocks();
		if (!blocks.length) {
			this.renderEmpty(el, lang);
			return;
		}
		this.renderPanel(el, blocks, lang);
	}

	private blocks(): Block[] {
		return this.plugin.activeKinds().map((kind) => ({
			kind,
			ids: this.plugin.targetsOf(kind),
			snapshot: this.plugin.snapshotOf(kind),
			info: this.plugin.infoOf(kind),
			keys: this.plugin.keysOf(kind),
		}));
	}

	private renderPanel(el: HTMLElement, blocks: Block[], lang: Lang): void {
		const panel = el.createDiv({ cls: 'census-panel' });
		const both = blocks.length > 1;
		const now = Date.now();

		for (const [index, block] of blocks.entries()) {
			const section = panel.createDiv({
				cls: index === 0 ? 'census-block' : 'census-block is-second',
			});
			this.renderBlock(section, block, lang, both, now);
		}
	}

	private renderBlock(el: HTMLElement, block: Block, lang: Lang, both: boolean, now: number): void {
		const samples = windowOf(this.plugin.history, HISTORY_DAYS, now);

		const head = el.createDiv({ cls: 'census-head' });
		const title = head.createSpan({ cls: 'census-title', text: this.blockTitle(block, lang, both) });

		// One target has somewhere to go, so the icons belong in its header;
		// a list carries one pair per row instead.
		const only = block.ids.length === 1 ? block.ids[0] : undefined;
		if (only) {
			const info = block.info[only];
			// A plugin's display name and a theme's author are the two things
			// the name alone does not say.
			const tip = block.kind === 'theme' ? info?.author : info?.name;
			title.setAttr('title', tip ?? only);
			this.addLinks(head, block, only, lang);
		}

		const change = changeOf(this.plugin.history, block.keys, HISTORY_DAYS, now);
		if (change) this.addDelta(head, change, samples.length, lang);

		// A plugin's numbers are republished as a file every day, so a curve is
		// a faithful picture of them. A theme's are a live counter with no daily
		// series behind them — drawing a line through two points of our own
		// sampling would invent a shape the source never had. So the theme
		// block states the number and stops there.
		if (block.kind === 'plugin') this.renderSpark(el, samples, block, lang);

		// The label sits beside the number rather than under it: at 44px the
		// number on its own is a headline without a caption, and the column is
		// wide enough to keep both on one line.
		const total = block.snapshot ? totalDownloads(block.snapshot, block.ids) : null;
		const row = el.createDiv({
			cls: block.kind === 'theme' ? 'census-total-row is-lede' : 'census-total-row',
		});
		const totalEl = row.createDiv({ cls: total === null ? 'census-total is-muted' : 'census-total' });
		if (total === null) {
			totalEl.setText(this.plugin.busy ? t(lang, 'panelChecking') : t(lang, 'unknown'));
		} else {
			totalEl.setText(formatFull(total));
		}

		this.renderCaption(row, block, lang);
		if (block.ids.length > 1) this.renderList(el, block, now, lang);
		this.renderFoot(el, block, samples.length, lang);
	}

	/**
	 * The name when there is one target, a tally otherwise. With both kinds on
	 * screen the tally drops the word "Census": it would head two blocks.
	 */
	private blockTitle(block: Block, lang: Lang, both: boolean): string {
		if (block.ids.length === 1) return block.ids[0] ?? '';

		const tally = t(lang, block.kind === 'theme' ? 'countThemes' : 'countPlugins', {
			count: String(block.ids.length),
		});
		return both ? tally : `Census · ${tally}`;
	}

	/** The delta pill: how much moved across the window, and by how much of it. */
	private addDelta(head: HTMLElement, change: Change, samples: number, lang: Lang): void {
		const pill = head.createSpan({ cls: 'census-delta' });

		if (change.delta > 0) {
			pill.addClass('is-up');
			pill.setText(`▲ ${formatFull(change.delta)}`);
		} else if (change.delta < 0) {
			pill.addClass('is-down');
			pill.setText(`▼ ${formatFull(Math.abs(change.delta))}`);
		} else {
			pill.addClass('is-flat');
			pill.setText('±0');
		}

		if (change.delta !== 0 && change.pct !== null) {
			const pct = Math.abs(change.pct);
			const text = pct >= 10 ? String(Math.round(pct)) : pct.toFixed(1);
			// "· 0.0%" beside a real change denies the change: at a theme's
			// magnitude a thousand downloads can be four hundredths of a
			// percent, and a rounded zero would say nothing moved.
			if (text !== '0.0') pill.appendText(` · ${text}%`);
		}
		pill.setAttr('title', t(lang, 'deltaHint', { days: String(HISTORY_DAYS), count: String(samples) }));
	}

	private renderSpark(parent: HTMLElement, samples: Sample[], block: Block, lang: Lang): void {
		const totals = samples.map((sample) => totalOf(sample, block.keys));

		// One point is not a curve, it is a dot with an opinion. Wait for a
		// second day rather than draw a line of length zero.
		if (totals.length < 2) {
			parent.createDiv({ cls: 'census-spark is-empty', text: t(lang, 'noHistory') });
			return;
		}

		const geometry = sparkOf(totals, CHART_WIDTH, CHART_HEIGHT);
		if (!geometry) return;

		const id = `census-chart-${++chartSeq}`;
		const wrap = parent.createDiv({ cls: 'census-spark' });
		const svg = wrap.createSvg('svg', {
			cls: 'census-chart',
			attr: {
				viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
				preserveAspectRatio: 'none',
				'aria-hidden': 'true',
			},
		});

		// Vanilla presentation attributes do not resolve `var()`; inline style
		// does, which is what keeps the chart on the theme's accent colour.
		const defs = svg.createSvg('defs');
		const areaFill = defs.createSvg('linearGradient', {
			attr: { id: `${id}-area`, x1: '0', y1: '0', x2: '0', y2: '1' },
		});
		areaFill.createSvg('stop', { attr: { offset: '0%', style: 'stop-color:var(--interactive-accent);stop-opacity:0.34' } });
		areaFill.createSvg('stop', { attr: { offset: '70%', style: 'stop-color:var(--interactive-accent);stop-opacity:0.07' } });
		areaFill.createSvg('stop', { attr: { offset: '100%', style: 'stop-color:var(--interactive-accent);stop-opacity:0' } });

		// The line fades in from the left: the far end of the window is the
		// part we know least about, and the eye should land on today.
		const lineStroke = defs.createSvg('linearGradient', {
			attr: { id: `${id}-line`, x1: '0', y1: '0', x2: '1', y2: '0' },
		});
		lineStroke.createSvg('stop', { attr: { offset: '0%', style: 'stop-color:var(--interactive-accent);stop-opacity:0.4' } });
		lineStroke.createSvg('stop', { attr: { offset: '65%', style: 'stop-color:var(--interactive-accent);stop-opacity:1' } });

		svg.createSvg('path', {
			attr: { d: geometry.area, fill: `url(#${id}-area)`, stroke: 'none' },
		});
		svg.createSvg('path', {
			cls: 'census-line',
			attr: {
				d: geometry.line,
				fill: 'none',
				stroke: `url(#${id}-line)`,
				'stroke-width': '2',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round',
				'vector-effect': 'non-scaling-stroke',
			},
		});
		svg.createSvg('circle', {
			attr: {
				cx: geometry.last.x,
				cy: geometry.last.y,
				r: '2.8',
				style: 'fill:var(--interactive-accent)',
			},
		});

		const axis = parent.createDiv({ cls: 'census-axis' });
		const first = samples[0];
		axis.createSpan({ text: first ? formatShortDate(first.t) : '' });
		axis.createSpan({ text: t(lang, 'axisToday') });
	}

	private renderCaption(parent: HTMLElement, block: Block, lang: Lang): void {
		// With no reading yet the number itself says "no reading"; "downloads"
		// hanging off that would read as one broken sentence.
		const unit = block.snapshot !== null;
		const listed = block.ids.filter((id) => block.snapshot?.entries[id]).length;
		const showListed = block.ids.length > 1;
		if (!unit && !showListed) return;

		const caption = parent.createDiv({ cls: 'census-caption' });
		if (unit) caption.createSpan({ text: t(lang, 'panelDownloads') });

		if (showListed) {
			if (unit) caption.createSpan({ text: ' · ' });
			const count = caption.createSpan({
				text: t(lang, 'panelListed', { listed: String(listed), total: String(block.ids.length) }),
			});
			if (listed < block.ids.length) count.addClass('is-warn');
		}
	}

	private renderList(parent: HTMLElement, block: Block, now: number, lang: Lang): void {
		const list = parent.createDiv({ cls: 'census-list' });
		const snapshot = block.snapshot;
		const values = block.ids.map((id) => snapshot?.entries[id]?.downloads ?? 0);
		const max = Math.max(...values, 1);
		const lead = Math.max(...values);

		// Biggest first, and the unpublished ones at the end: a list that is
		// half dashes reads as a bug unless the dashes are kept together.
		// `sort` is stable, so ties keep the order they were added in.
		const ordered = [...block.ids].sort(
			(a, b) => (snapshot?.entries[b]?.downloads ?? -1) - (snapshot?.entries[a]?.downloads ?? -1),
		);

		for (const id of ordered) {
			const entry = snapshot?.entries[id];
			const item = list.createDiv({ cls: 'census-item' });
			const top = item.createDiv({ cls: 'census-item-top' });

			const name = top.createSpan({ cls: 'census-item-name', text: id });
			const info = block.info[id];
			if (block.kind === 'theme') {
				if (info?.author) name.setAttr('title', info.author);
			} else if (info?.name) {
				name.setAttr('title', info.name);
			}

			// Right after the name, so the two doors belong to that row and not
			// to the number at the end of it.
			this.addLinks(top, block, id, lang);

			const delta = changeFor(this.plugin.history, keyOf({ kind: block.kind, id }), HISTORY_DAYS, now);
			const deltaEl = top.createSpan({ cls: 'census-item-delta' });
			if (delta === null) {
				deltaEl.addClass('is-flat');
			} else if (delta > 0) {
				deltaEl.addClass('is-up');
				deltaEl.setText(`+${formatFull(delta)}`);
			} else if (delta < 0) {
				deltaEl.addClass('is-down');
				deltaEl.setText(`−${formatFull(Math.abs(delta))}`);
			} else {
				deltaEl.addClass('is-flat');
				deltaEl.setText('±0');
			}

			const value = top.createSpan({
				cls: entry ? 'census-item-value' : 'census-item-value is-missing',
				text: entry ? formatFull(entry.downloads) : '—',
			});
			// A dash could be read as "zero"; say which one it is.
			if (!entry) value.setAttr('title', t(lang, 'notListedShort'));

			const track = item.createDiv({ cls: entry ? 'census-track' : 'census-track is-empty' });
			if (entry) {
				track.createSpan({
					cls: entry.downloads === lead ? 'census-fill is-lead' : 'census-fill',
					attr: { style: `width:${Math.max(1.2, (entry.downloads / max) * 100).toFixed(2)}%` },
				});
			}
		}
	}

	private renderFoot(parent: HTMLElement, block: Block, samples: number, lang: Lang): void {
		const busy = this.plugin.busy;
		const backfilling = this.plugin.backfilling && block.kind === 'plugin';
		const snapshot = block.snapshot;

		const foot = parent.createDiv({ cls: 'census-foot' });
		const meta = foot.createDiv({ cls: 'census-foot-meta' });

		if (backfilling) {
			meta.setText(
				t(lang, 'backfillRunning', {
					done: String(this.plugin.backfillDone),
					total: String(this.plugin.backfillTotal),
				}),
			);
		} else if (snapshot) {
			meta.setText(
				`${t(lang, 'samples', { count: String(samples) })} · ${t(lang, 'checkedAt', {
					when: formatWhen(snapshot.fetchedAt),
				})}`,
			);
			const only = block.ids.length === 1 ? block.ids[0] : undefined;
			const entry = only ? snapshot.entries[only] : undefined;
			if (entry?.publishedAt) {
				meta.setAttr('title', t(lang, 'panelPublishedAt', { when: formatWhen(entry.publishedAt) }));
			}
		} else {
			meta.setText(busy ? t(lang, 'panelChecking') : t(lang, 'never'));
		}

		const actions = foot.createDiv({ cls: 'census-actions' });

		// Until there is enough of a series to draw, the honest thing to offer
		// is a way to get one now rather than "come back in three days". Only
		// the plugin directory keeps a history that can be read back, so the
		// theme block offers nothing it cannot deliver.
		if (block.kind === 'plugin' && !backfilling && samples < 3) {
			const backfill = actions.createEl('button', { cls: 'census-btn', text: t(lang, 'backfillShort') });
			backfill.setAttr('title', t(lang, 'backfillHint', { days: String(HISTORY_DAYS) }));
			backfill.addEventListener('click', () => void this.plugin.backfill());
		}

		const refresh = actions.createEl('button', {
			cls: 'census-btn',
			text: busy ? t(lang, 'panelChecking') : t(lang, 'panelRefresh'),
		});
		if (busy || backfilling) refresh.setAttr('disabled', 'true');
		refresh.addEventListener('click', () => void this.plugin.refresh(true));
	}

	/** The two doors out of a row: the listing page and the source. */
	private addLinks(parent: HTMLElement, block: Block, id: string, lang: Lang): void {
		const links = parent.createDiv({ cls: 'census-links' });

		const page = block.kind === 'theme' ? themePageUrl(id) : `${PLUGIN_PAGE_URL}${id}`;
		if (page) {
			this.addLink(
				links,
				page,
				t(lang, block.kind === 'theme' ? 'openThemePage' : 'openPage'),
				true,
			);
		}

		const repo = repoUrl(block.info[id]?.repo);
		// Not in the directory yet means no repository to point at. An icon
		// that goes nowhere is worse than space where it would be.
		if (repo) this.addLink(links, repo, t(lang, 'openRepo'), false);
	}

	private addLink(parent: HTMLElement, href: string, label: string, obsidian: boolean): void {
		const link = parent.createEl('a', {
			cls: 'census-icon',
			attr: { href, 'aria-label': label, title: label, target: '_blank', rel: 'noopener' },
		});
		if (obsidian) this.drawMark(link);
		else this.drawOctocat(link);

		link.addEventListener('click', (event) => {
			// Obsidian's own tabs open in the browser; a bare anchor inside a
			// custom view can just as easily navigate the app window.
			event.preventDefault();
			window.open(href, '_blank');
		});
	}

	/** Obsidian's logo: there is no name for it in the icon set. */
	private drawMark(parent: HTMLElement): void {
		// `cls` here goes through classList.add, which rejects a space-separated
		// string -- so the second class has to be added on its own.
		const svg = parent.createSvg('svg', {
			cls: 'census-mark',
			attr: { viewBox: OBSIDIAN_MARK_VIEWBOX, 'aria-hidden': 'true', focusable: 'false' },
		});
		svg.addClass('svg-icon');
		svg.createSvg('path', { cls: 'census-mark-body', attr: { d: OBSIDIAN_MARK_BODY } });
		svg.createSvg('path', { cls: 'census-mark-shade', attr: { d: OBSIDIAN_MARK_FACET_RIGHT } });
		svg.createSvg('path', { cls: 'census-mark-shade-deep', attr: { d: OBSIDIAN_MARK_FACET_LEFT } });
	}

	/** The solid octocat, so both marks in a row are drawn the same way. */
	private drawOctocat(parent: HTMLElement): void {
		const svg = parent.createSvg('svg', {
			cls: 'census-octocat',
			attr: { viewBox: GITHUB_MARK_VIEWBOX, 'aria-hidden': 'true', focusable: 'false' },
		});
		svg.addClass('svg-icon');
		svg.createSvg('path', { attr: { d: GITHUB_MARK_BODY } });
	}

	private renderEmpty(el: HTMLElement, lang: Lang): void {
		el.createDiv({ cls: 'census-empty', text: t(lang, 'panelEmpty') });
		const button = el.createEl('button', {
			cls: 'census-btn mod-cta',
			text: t(lang, 'panelOpenSettings'),
		});
		button.addEventListener('click', () => this.plugin.openSettings());
	}
}
