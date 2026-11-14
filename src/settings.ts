import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { HISTORY_DAYS, PLUGIN_PAGE_URL, REFRESH_HOURS_DEFAULT } from './constants';
import { Lang, detectLang, t } from './i18n';
import { repoUrl } from './registry';
import { formatFull, formatShortDate, formatWhen, totalDownloads } from './stats';
import type CensusPlugin from './main';

export interface CensusSettings {
	/** Community plugin ids, in the order the user added them. */
	targets: string[];
	showInStatusBar: boolean;
	/** How long a fetched snapshot is trusted, in hours. */
	refreshHours: number;
}

export const DEFAULT_SETTINGS: CensusSettings = {
	targets: [],
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
		const lang = this.lang;
		containerEl.empty();

		const ids = this.plugin.targetIds();
		const snapshot = this.plugin.snapshot;

		new Setting(containerEl).setName(t(lang, 'sectionTargets')).setHeading();

		// One row per tracked plugin: what it is, what it has, and a way out.
		const list = containerEl.createDiv({ cls: 'census-targets' });
		if (!ids.length) {
			list.createDiv({ cls: 'census-targets-empty', text: t(lang, 'noTargets') });
		}

		for (const id of ids) {
			const entry = snapshot?.entries[id];
			const row = list.createDiv({ cls: 'census-target-row' });

			const name = row.createEl('a', {
				cls: 'census-target-name',
				text: id,
				href: `${PLUGIN_PAGE_URL}${id}`,
			});
			name.setAttr('title', t(lang, 'openPage'));

			const count = row.createSpan({
				cls: entry ? 'census-target-count' : 'census-target-count is-missing',
				text: entry ? formatFull(entry.downloads) : '—',
			});
			if (!entry) count.setAttr('title', t(lang, 'notListedShort'));

			const repo = repoUrl(this.plugin.info[id]?.repo);
			if (repo) {
				const link = row.createEl('a', {
					cls: 'census-target-link',
					attr: {
						href: repo,
						'aria-label': t(lang, 'openRepo'),
						title: t(lang, 'openRepo'),
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
			remove.setAttr('aria-label', t(lang, 'remove'));
			remove.setAttr('title', t(lang, 'remove'));
			setIcon(remove, 'x');
			remove.addEventListener('click', () => {
				void this.plugin.removeTarget(id).then(() => this.display());
			});
		}

		let input: HTMLInputElement | null = null;
		const commit = async (): Promise<void> => {
			if (!input) return;
			const added = await this.plugin.addTarget(input.value);
			if (added) this.display();
		};

		new Setting(containerEl)
			.setName(t(lang, 'addTarget'))
			.setDesc(t(lang, 'addTargetDesc'))
			.addText((text) => {
				input = text.inputEl;
				text.setPlaceholder('weekly-schedule');
				// Enter is what a one-field form means; requiring a click would be
				// a small rudeness repeated every time a plugin is added.
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					void commit();
				});
			})
			.addButton((button) => {
				button
					.setButtonText(t(lang, 'add'))
					.setCta()
					.onClick(() => void commit());
			});

		new Setting(containerEl).setName(t(lang, 'sectionWhere')).setHeading();

		new Setting(containerEl)
			.setName(t(lang, 'settingsStatusBar'))
			.setDesc(t(lang, 'settingsStatusBarDesc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showInStatusBar);
				toggle.onChange(async (value) => {
					this.plugin.settings.showInStatusBar = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings({ refetch: false });
				});
			});

		new Setting(containerEl)
			.setName(t(lang, 'settingsPanel'))
			.setDesc(t(lang, 'settingsPanelDesc'))
			.addButton((button) => {
				button.setButtonText(t(lang, 'openPanel')).onClick(() => {
					void this.plugin.activateView();
				});
			});

		new Setting(containerEl)
			.setName(t(lang, 'settingsRefreshHours'))
			.setDesc(t(lang, 'settingsRefreshHoursDesc'))
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

		new Setting(containerEl).setName(t(lang, 'sectionHistory')).setHeading();

		const historyRow = new Setting(containerEl)
			.setName(this.historySummary(lang))
			.setDesc(t(lang, 'historyDesc'));

		historyRow.addButton((button) => {
			button
				.setButtonText(t(lang, 'backfill'))
				.setTooltip(t(lang, 'backfillHint', { days: String(HISTORY_DAYS) }))
				.onClick(async () => {
					await this.plugin.backfill();
					this.display();
				});
		});

		historyRow.addButton((button) => {
			button
				.setButtonText(t(lang, 'clearHistory'))
				.setWarning()
				.onClick(async () => {
					await this.plugin.clearHistory();
					this.display();
				});
		});

		new Setting(containerEl).setName(t(lang, 'sectionNow')).setHeading();

		const row = new Setting(containerEl).setName(t(lang, 'settingsReading'));
		if (!ids.length || !snapshot) {
			row.setDesc(t(lang, 'never'));
		} else if (ids.length === 1) {
			const id = ids[0];
			const entry = id ? snapshot.entries[id] : undefined;
			row.setDesc(
				entry
					? `${formatFull(entry.downloads)} · ${t(lang, 'checkedAt', { when: formatWhen(snapshot.fetchedAt) })}`
					: t(lang, 'notListedShort'),
			);
		} else {
			row.setDesc(
				t(lang, 'settingsTotal', {
					count: String(ids.length),
					total: formatFull(totalDownloads(snapshot, ids)),
					when: formatWhen(snapshot.fetchedAt),
				}),
			);
		}

		row.addButton((button) => {
			button.setButtonText(t(lang, 'refreshNow')).onClick(async () => {
				await this.plugin.refresh(true);
				this.display();
			});
		});

		if (ids.length === 1) {
			row.addExtraButton((button) => {
				button
					.setIcon('external-link')
					.setTooltip(t(lang, 'openPage'))
					.onClick(() => {
						window.open(`${PLUGIN_PAGE_URL}${ids[0]}`, '_blank');
					});
			});
		}
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
