import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { HISTORY_DAYS, PLUGIN_PAGE_URL, REFRESH_HOURS_DEFAULT } from './constants';
import { Lang, detectLang, t } from './i18n';
import { repoUrl, themePageUrl } from './registry';
import { Kind, formatFull, formatShortDate, formatWhen } from './stats';
import type CensusPlugin from './main';

export interface CensusSettings {
	/** Community plugin ids, in the order the user added them. */
	targets: string[];
	/** Theme display names, exact and in the order added — they are the keys. */
	themeTargets: string[];
	showInStatusBar: boolean;
	/** How long a fetched snapshot is trusted, in hours. */
	refreshHours: number;
}

export const DEFAULT_SETTINGS: CensusSettings = {
	targets: [],
	themeTargets: [],
	showInStatusBar: true,
	refreshHours: REFRESH_HOURS_DEFAULT,
};

export class CensusSettingTab extends PluginSettingTab {
	private lang: Lang = detectLang();

	constructor(app: App, private plugin: CensusPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Two sections rather than one list with a type switch: the two
		// directories are keyed differently (a slug, a display name) and only
		// one of them can be backfilled, so a merged list would have to explain
		// that in every row.
		new Setting(containerEl).setName(t(this.lang, 'sectionTargets')).setHeading();
		this.renderList('plugin');
		this.renderAdd('plugin', 'weekly-schedule');

		new Setting(containerEl).setName(t(this.lang, 'sectionThemes')).setHeading();
		this.renderList('theme');
		this.renderAdd('theme', 'Minimal');

		this.renderWhere();
		this.renderHistory();
		this.renderReading();
	}

	/** One row per tracked target: what it is, what it has, and a way out. */
	private renderList(kind: Kind): void {
		const ids = this.plugin.targetsOf(kind);
		const snapshot = this.plugin.snapshotOf(kind);
		const info = this.plugin.infoOf(kind);

		const list = this.containerEl.createDiv({ cls: 'census-targets' });
		if (!ids.length) {
			list.createDiv({
				cls: 'census-targets-empty',
				text: t(this.lang, kind === 'theme' ? 'noThemes' : 'noTargets'),
			});
			return;
		}

		for (const id of ids) {
			const entry = snapshot?.entries[id];
			const row = list.createDiv({ cls: 'census-target-row' });

			// A theme's name is also the label of its page; a plugin's page is
			// addressed by id, which is what the row shows either way.
			const href =
				kind === 'theme' ? themePageUrl(id) : `${PLUGIN_PAGE_URL}${id}`;
			const name = href
				? row.createEl('a', { cls: 'census-target-name', text: id, href })
				: row.createSpan({ cls: 'census-target-name', text: id });
			name.setAttr('title', t(this.lang, kind === 'theme' ? 'openThemePage' : 'openPage'));

			const count = row.createSpan({
				cls: entry ? 'census-target-count' : 'census-target-count is-missing',
				text: entry ? formatFull(entry.downloads) : '—',
			});
			if (!entry) count.setAttr('title', t(this.lang, 'notListedShort'));

			const repo = repoUrl(info[id]?.repo);
			if (repo) {
				const link = row.createEl('a', {
					cls: 'census-target-link',
					attr: {
						href: repo,
						'aria-label': t(this.lang, 'openRepo'),
						title: t(this.lang, 'openRepo'),
						target: '_blank',
						rel: 'noopener',
					},
				});
				setIcon(link, 'github');
				link.addEventListener('click', (event) => {
					event.preventDefault();
					window.open(repo, '_blank');
				});
			}

			const remove = row.createEl('button', { cls: 'census-target-remove' });
			remove.setAttr('aria-label', t(this.lang, 'remove'));
			remove.setAttr('title', t(this.lang, 'remove'));
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				void this.plugin.removeTarget(kind, id).then(() => this.display());
			});
		}
	}

	private renderAdd(kind: Kind, placeholder: string): void {
		let input: HTMLInputElement | null = null;
		const commit = async (): Promise<void> => {
			if (!input) return;
			const added = await this.plugin.addTarget(kind, input.value);
			if (added) this.display();
		};

		new Setting(this.containerEl)
			.setName(t(this.lang, kind === 'theme' ? 'addTheme' : 'addTarget'))
			.setDesc(t(this.lang, kind === 'theme' ? 'addThemeDesc' : 'addTargetDesc'))
			.addText((text) => {
				input = text.inputEl;
				text.setPlaceholder(placeholder);
				// Enter is what a one-field form means; requiring a click would be
				// a small rudeness repeated every time something is added.
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					void commit();
				});
			})
			.addButton((button) => {
				button
					.setButtonText(t(this.lang, 'add'))
					.setCta()
					.onClick(() => void commit());
			});
	}

	private renderWhere(): void {
		new Setting(this.containerEl).setName(t(this.lang, 'sectionWhere')).setHeading();

		new Setting(this.containerEl)
			.setName(t(this.lang, 'settingsStatusBar'))
			.setDesc(t(this.lang, 'settingsStatusBarDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showInStatusBar);
				toggle.onChange(async (value) => {
					this.plugin.settings.showInStatusBar = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings({ refetch: false });
				});
			});

		new Setting(this.containerEl)
			.setName(t(this.lang, 'settingsPanel'))
			.setDesc(t(this.lang, 'settingsPanelDesc'))
			.addButton((button) => {
				button.setButtonText(t(this.lang, 'openPanel')).onClick(() => {
					void this.plugin.activateView();
				});
			});

		new Setting(this.containerEl)
			.setName(t(this.lang, 'settingsRefreshHours'))
			.setDesc(t(this.lang, 'settingsRefreshHoursDesc'))
			.addSlider((slider) => {
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.refreshHours)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.refreshHours = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderHistory(): void {
		new Setting(this.containerEl).setName(t(this.lang, 'sectionHistory')).setHeading();

		const historyRow = new Setting(this.containerEl)
			.setName(this.historySummary(this.lang))
			.setDesc(t(this.lang, 'historyDesc'));

		// The panel is honest about this in the theme block; the setting that
		// offers a backfill says it once, where the button is.
		const hasPlugins = this.plugin.targetsOf('plugin').length > 0;
		if (this.plugin.targetsOf('theme').length) {
			this.containerEl.createDiv({ cls: 'census-note', text: t(this.lang, 'themeHistoryNote') });
		}

		historyRow.addButton((button) => {
			button
				.setButtonText(t(this.lang, 'backfill'))
				// Nothing to read backwards without a plugin target, so the
				// button says why instead of failing after a click.
				.setTooltip(
					hasPlugins
						? t(this.lang, 'backfillHint', { days: String(HISTORY_DAYS) })
						: t(this.lang, 'backfillNoPlugins'),
				)
				.setDisabled(!hasPlugins)
				.onClick(async () => {
					await this.plugin.backfill();
					this.display();
				});
		});

		historyRow.addButton((button) => {
			button
				.setButtonText(t(this.lang, 'clearHistory'))
				.setWarning()
				.onClick(async () => {
					await this.plugin.clearHistory();
					this.display();
				});
		});
	}

	private renderReading(): void {
		new Setting(this.containerEl).setName(t(this.lang, 'sectionNow')).setHeading();

		const targets = this.plugin.allTargets();
		const row = new Setting(this.containerEl).setName(t(this.lang, 'settingsReading'));

		if (!targets.length) {
			row.setDesc(t(this.lang, 'never'));
		} else if (targets.length === 1) {
			const only = targets[0];
			const entry = only ? this.plugin.snapshotOf(only.kind)?.entries[only.id] : undefined;
			row.setDesc(
				entry
					? `${formatFull(entry.downloads)} · ${t(this.lang, 'checkedAt', {
							when: formatWhen(this.checkedAt()),
						})}`
					: t(this.lang, 'notListedShort'),
			);
		} else {
			row.setDesc(
				t(this.lang, 'settingsTotal', {
					summary: this.plugin.summaryLabel(),
					total: formatFull(this.plugin.totalAll()),
					when: formatWhen(this.checkedAt()),
				}),
			);
		}

		row.addButton((button) => {
			button.setButtonText(t(this.lang, 'refreshNow')).onClick(async () => {
				await this.plugin.refresh(true);
				this.display();
			});
		});

		if (targets.length === 1 && targets[0]) {
			const only = targets[0];
			row.addExtraButton((button) => {
				button
					.setIcon('external-link')
					.setTooltip(t(this.lang, only.kind === 'theme' ? 'openThemePage' : 'openPage'))
					.onClick(() => {
						const href =
							only.kind === 'theme' ? themePageUrl(only.id) : `${PLUGIN_PAGE_URL}${only.id}`;
						if (href) window.open(href, '_blank');
					});
			});
		}
	}

	/** When the numbers on screen were read; the oldest source wins. */
	private checkedAt(): number {
		return this.plugin.oldestFetchedAt() ?? Date.now();
	}

	/** "30 days recorded, 10-16 → 11-14" — or the honest empty answer. */
	private historySummary(lang: Lang): string {
		const samples = this.plugin.history;
		const first = samples[0];
		const last = samples[samples.length - 1];
		if (!first || !last) return t(lang, 'historyEmpty');

		return t(lang, 'historyCount', {
			count: String(samples.length),
			from: formatShortDate(first.t),
			to: formatShortDate(last.t),
		});
	}
}
