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
import { repoUrl } from './registry';
import { Snapshot, formatFull, formatShortDate, formatWhen, totalDownloads } from './stats';
import type CensusPlugin from './main';

/** The chart is drawn in this coordinate space and stretched to the column. */
const CHART_WIDTH = 300;
const CHART_HEIGHT = 56;

/** Gradient ids have to be unique per document; one render can build several. */
let chartSeq = 0;

/**
 * The reading as a sidebar tab.
 *
 * The shape is a curve and a list: the curve answers "is it moving", the list
 * answers "who is moving". Above them sits one number big enough to read from
 * across the desk, which is the only reason to put this in a sidebar instead
 * of on a web page.
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
		return 'users';
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
		const ids = this.plugin.targetIds();
		if (!ids.length) {
			this.renderEmpty(el, lang);
			return;
		}
		this.renderPanel(el, ids, lang);
	}

	private renderPanel(el: HTMLElement, ids: string[], lang: Lang): void {
		const snapshot = this.plugin.snapshot;
		const now = Date.now();

		const panel = el.createDiv({ cls: 'census-panel' });
		const samples = windowOf(this.plugin.history, HISTORY_DAYS, now);

		const head = panel.createDiv({ cls: 'census-head' });
		const title = head.createSpan({
			cls: 'census-title',
			text:
				ids.length === 1
					? (ids[0] ?? '')
					: `Census · ${t(lang, 'panelCount', { count: String(ids.length) })}`,
		});
		if (ids.length === 1 && ids[0]) title.setAttr('title', this.plugin.info[ids[0]]?.name ?? ids[0]);

		// One plugin has somewhere to go, so the icons belong in its header;
		// a list carries one pair per row instead.
		if (ids.length === 1 && ids[0]) this.addLinks(head, ids[0], lang);

		const change = changeOf(this.plugin.history, ids, HISTORY_DAYS, now);
		if (change) this.addDelta(head, change, samples.length, lang);

		this.renderSpark(panel, samples, ids, lang);

		// The label sits beside the number rather than under it: at 44px the
		// number on its own is a headline without a caption, and the column is
		// wide enough to keep both on one line.
		const total = snapshot ? totalDownloads(snapshot, ids) : null;
		const row = panel.createDiv({ cls: 'census-total-row' });
		const totalEl = row.createDiv({ cls: total === null ? 'census-total is-muted' : 'census-total' });
		if (total === null) {
			totalEl.setText(this.plugin.busy ? t(lang, 'panelChecking') : t(lang, 'unknown'));
		} else {
			totalEl.setText(formatFull(total));
		}

		this.renderCaption(row, ids, snapshot, lang);
		if (ids.length > 1) this.renderList(panel, ids, snapshot, now, lang);
		this.renderFoot(panel, ids, snapshot, samples.length, lang);
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
			pill.appendText(` · ${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`);
		}
		pill.setAttr('title', t(lang, 'deltaHint', { days: String(HISTORY_DAYS), count: String(samples) }));
	}

	private renderSpark(parent: HTMLElement, samples: Sample[], ids: string[], lang: Lang): void {
		const totals = samples.map((sample) => totalOf(sample, ids));

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

	private renderCaption(
		parent: HTMLElement,
		ids: string[],
		snapshot: Snapshot | null,
		lang: Lang,
	): void {
		// With no reading yet the number itself says "no reading"; "downloads"
		// hanging off that would read as one broken sentence.
		const unit = snapshot !== null;
		const listed = ids.filter((id) => snapshot?.entries[id]).length;
		const showListed = ids.length > 1;
		if (!unit && !showListed) return;

		const caption = parent.createDiv({ cls: 'census-caption' });
		if (unit) caption.createSpan({ text: t(lang, 'panelDownloads') });

		if (showListed) {
			if (unit) caption.createSpan({ text: ' · ' });
			const count = caption.createSpan({
				text: t(lang, 'panelListed', { listed: String(listed), total: String(ids.length) }),
			});
			if (listed < ids.length) count.addClass('is-warn');
		}
	}

	private renderList(
		parent: HTMLElement,
		ids: string[],
		snapshot: Snapshot | null,
		now: number,
		lang: Lang,
	): void {
		const list = parent.createDiv({ cls: 'census-list' });
		const values = ids.map((id) => snapshot?.entries[id]?.downloads ?? 0);
		const max = Math.max(...values, 1);
		const lead = Math.max(...values);

		// Biggest first, and the unpublished ones at the end: a list that is
		// half dashes reads as a bug unless the dashes are kept together.
		// `sort` is stable, so ties keep the order they were added in.
		const ordered = [...ids].sort(
			(a, b) => (snapshot?.entries[b]?.downloads ?? -1) - (snapshot?.entries[a]?.downloads ?? -1),
		);

		for (const id of ordered) {
			const entry = snapshot?.entries[id];
			const item = list.createDiv({ cls: 'census-item' });
			const top = item.createDiv({ cls: 'census-item-top' });

			const name = top.createSpan({ cls: 'census-item-name', text: id });
			const info = this.plugin.info[id];
			if (info?.name) name.setAttr('title', info.name);

			// Right after the name, so the two doors belong to that row and not
			// to the number at the end of it.
			this.addLinks(top, id, lang);

			const delta = changeFor(this.plugin.history, id, HISTORY_DAYS, now);
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

	private renderFoot(
		parent: HTMLElement,
		ids: string[],
		snapshot: Snapshot | null,
		samples: number,
		lang: Lang,
	): void {
		const busy = this.plugin.busy;
		const backfilling = this.plugin.backfilling;

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
			const only = ids.length === 1 ? ids[0] : undefined;
			const entry = only ? snapshot.entries[only] : undefined;
			if (entry?.publishedAt) {
				meta.setAttr('title', t(lang, 'panelPublishedAt', { when: formatWhen(entry.publishedAt) }));
			}
		} else {
			meta.setText(busy ? t(lang, 'panelChecking') : t(lang, 'never'));
		}

		const actions = foot.createDiv({ cls: 'census-actions' });

		// Until there is enough of a series to draw, the honest thing to offer
		// is a way to get one now rather than "come back in three days".
		if (!backfilling && samples < 3) {
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
	private addLinks(parent: HTMLElement, id: string, lang: Lang): void {
		const links = parent.createDiv({ cls: 'census-links' });
		this.addLink(links, `${PLUGIN_PAGE_URL}${id}`, t(lang, 'openPage'), true);

		const repo = repoUrl(this.plugin.info[id]?.repo);
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
