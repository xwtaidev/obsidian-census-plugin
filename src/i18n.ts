export type Lang = 'en' | 'zh';

const DICT = {
	commandShow: { en: 'Show download counts', zh: '查看下载量' },
	commandRefresh: { en: 'Refresh download counts', zh: '刷新下载量' },
	commandOpenPanel: { en: 'Open the reading panel', zh: '在侧边栏打开读数' },
	ribbonOpen: { en: 'Census: open the reading panel', zh: 'Census：打开读数面板' },

	noTarget: {
		en: 'Add a plugin id in Census settings first.',
		zh: '请先在 Census 设置里添加插件 ID。',
	},
	notListed: {
		en: 'No plugin with id “{id}” in the official stats.',
		zh: '官方统计里找不到 ID 为「{id}」的插件。',
	},
	notListedShort: { en: 'not listed', zh: '未收录' },
	someNotListed: {
		en: 'Not in the official stats: {ids}',
		zh: '官方统计里找不到这些 ID：{ids}',
	},
	networkFailed: {
		en: 'Could not read the stats file. Keeping the last numbers.',
		zh: '读不到统计文件，先显示上次的数字。',
	},
	reading: { en: '{name} — {count} downloads', zh: '{name} — {count} 次下载' },
	readingMany: {
		en: '{count} plugins — {total} downloads in total',
		zh: '{count} 个插件 — 合计 {total} 次下载',
	},
	readingMeta: {
		en: 'Checked {checked}{published}',
		zh: '获取于 {checked}{published}',
	},
	checkedAt: { en: 'Checked {when}', zh: '获取于 {when}' },
	publishedSuffix: { en: ' · official total last updated {date}', zh: ' · 官方数据更新于 {date}' },
	statusIdle: { en: 'Census', zh: 'Census' },
	statusTooltip: {
		en: '{name}: {count} downloads. Click to refresh.',
		zh: '{name}：{count} 次下载。点击刷新。',
	},
	statusManyTooltip: {
		en: '{count} plugins, {total} downloads in total. Click for the breakdown. {list}',
		zh: '{count} 个插件，合计 {total} 次下载。点击查看明细。{list}',
	},

	sectionTargets: { en: 'Tracked plugins', zh: '跟踪的插件' },
	noTargets: {
		en: 'Nothing tracked yet. Add a plugin id below.',
		zh: '还没有跟踪任何插件，在下面添加一个。',
	},
	addTarget: { en: 'Add a plugin', zh: '添加插件' },
	addTargetDesc: {
		en: 'The id, not the name — it is also the folder name under .obsidian/plugins. A plugin page reads obsidian.md/plugins?id=<id>.',
		zh: '填 ID 而不是名字，它同时也是 .obsidian/plugins 下的文件夹名。插件页面地址是 obsidian.md/plugins?id=<ID>。',
	},
	add: { en: 'Add', zh: '添加' },
	remove: { en: 'Remove', zh: '移除' },

	sectionWhere: { en: 'Where it shows', zh: '显示位置' },
	settingsStatusBar: { en: 'Status bar reading', zh: '状态栏读数' },
	settingsStatusBarDesc: {
		en: 'One plugin shows its id and count; several show the total. Click to refresh.',
		zh: '只有一个插件时显示它的 ID 与数字，多个时显示合计。点一下即刷新。',
	},
	settingsPanel: { en: 'Right sidebar panel', zh: '右侧边栏面板' },
	settingsPanelDesc: {
		en: 'A tab in the right sidebar: the curve on top, the total under it, then one row per plugin.',
		zh: '在右侧边栏开一个标签页：上面是曲线，下面是合计，再往下每个插件一行。',
	},
	settingsRefreshHours: { en: 'Hours between checks', zh: '自动刷新间隔（小时）' },
	settingsRefreshHoursDesc: {
		en: 'One file holds every plugin, so a longer list costs the same single request.',
		zh: '一个文件里就包含所有插件，所以加再多插件也还是同一次请求。',
	},

	sectionNow: { en: 'Current reading', zh: '当前读数' },
	settingsReading: { en: 'Downloads', zh: '下载量' },
	settingsTotal: {
		en: '{count} plugins · {total} downloads · checked {when}',
		zh: '{count} 个插件 · 合计 {total} · 获取于 {when}',
	},
	refreshNow: { en: 'Refresh now', zh: '立即刷新' },
	openPage: { en: 'Open the plugin page', zh: '打开插件页面' },
	openPanel: { en: 'Open in the right sidebar', zh: '在右侧边栏打开' },
	never: { en: 'not fetched yet', zh: '尚未获取' },
	unknown: { en: 'no reading', zh: '暂无读数' },

	/* The right-sidebar panel. Narrow column, so one number per line. */
	panelDownloads: { en: 'downloads', zh: '次下载' },
	panelCount: { en: '{count} plugins', zh: '{count} 个插件' },
	panelListed: { en: '{listed}/{total} listed', zh: '{listed}/{total} 个已收录' },
	panelPublishedAt: { en: 'Official total updated {when}', zh: '官方数据更新于 {when}' },
	panelChecking: { en: 'Checking…', zh: '正在读取…' },
	panelEmpty: {
		en: 'No plugins yet. Add an id in the settings and the numbers show up here.',
		zh: '还没有插件。在设置里添加一个 ID，读数就会出现在这里。',
	},
	panelOpenSettings: { en: 'Open settings', zh: '打开设置' },
	panelRefresh: { en: 'Refresh', zh: '刷新' },

	/* The curve. One point per day, so it has to explain when it is thin. */
	noHistory: {
		en: 'No curve yet — it needs a few days of samples.',
		zh: '还没有曲线，需要几天的采样。',
	},
	axisToday: { en: 'today', zh: '今天' },
	deltaHint: {
		en: 'Change over the last {days} days, from {count} samples.',
		zh: '近 {days} 天的变化，来自 {count} 次采样。',
	},
	samples: { en: '{count} samples', zh: '{count} 次采样' },
	openRepo: { en: 'Open the GitHub repository', zh: '打开 GitHub 仓库' },

	/* Backfilling: reading the file's own commits so the chart is not empty. */
	backfillShort: { en: 'Backfill', zh: '补历史' },
	backfillHint: {
		en: 'Read one commit per day for the last {days} days — about {days} requests, once.',
		zh: '按天读取统计文件的历史提交，最多 {days} 天，约 {days} 次请求，只做一次。',
	},
	backfillRunning: { en: 'Backfilling {done}/{total}…', zh: '正在回填 {done}/{total}…' },
	backfillDone: { en: 'Added {count} days of history.', zh: '已补上 {count} 天历史。' },
	backfillFailed: { en: 'Could not read the file history.', zh: '读不到统计文件的历史。' },

	sectionHistory: { en: 'Trend history', zh: '曲线历史' },
	historyDesc: {
		en: "The panel keeps one point per day, written when a check lands on a new day. Backfilling reads the stats file's own commits, so the curve has a month behind it as soon as the plugin is installed.",
		zh: '面板每天记一个点，靠每次检查落在新的一天时写入。回填会去读统计文件自己的历史提交，装上就能有一个月的曲线。',
	},
	historyCount: { en: '{count} days recorded, {from} → {to}', zh: '已记录 {count} 天，{from} → {to}' },
	historyEmpty: { en: 'Nothing recorded yet.', zh: '还没有记录。' },
	backfill: { en: 'Backfill 30 days', zh: '回填最近 30 天' },
	clearHistory: { en: 'Clear history', zh: '清空历史' },
} as const;

export type TextKey = keyof typeof DICT;

export function detectLang(): Lang {
	const locale = (window.localStorage.getItem('language') ?? navigator.language ?? 'en').toLowerCase();
	return locale.startsWith('zh') ? 'zh' : 'en';
}

export function t(lang: Lang, key: TextKey, vars?: Record<string, string>): string {
	const template: string = DICT[key][lang];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}
