/**
 * Obsidian publishes one total per community plugin here, once a day. The same
 * file the plugin browser and every download badge in the wild reads, so a
 * number from it matches what a user sees when they install the plugin.
 *
 * It is roughly 3 MB, which is why a reading is kept for hours rather than
 * fetched on every keystroke of the id field.
 */
export const PLUGIN_STATS_URL =
	'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json';

/** The file behind {@link PLUGIN_STATS_URL}, for reading older commits of it. */
export const PLUGIN_STATS_FILE = 'community-plugin-stats.json';

/** Where the listing lives, for the link from the settings tab. */
export const PLUGIN_PAGE_URL = 'https://obsidian.md/plugins?id=';

/**
 * The directory index: one object per published plugin with `id`, `name`,
 * `author` and — the reason it is fetched at all — `repo`. The stats file has
 * no repository field, so a GitHub link cannot be built without this.
 *
 * 3.2 MB, and it changes when plugins are published or renamed, which is
 * rarely something a tracked plugin does. Hence a week-long trust window.
 */
export const PLUGIN_INDEX_URL =
	'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';

export const REPO_URL = 'https://github.com/';

/**
 * The stats file is committed once a day, so its own history is a daily log we
 * can read backwards — the only way to draw a curve for a plugin installed
 * today. One request per day, and the commits listing is one request total.
 */
export const COMMITS_API = `https://api.github.com/repos/obsidianmd/obsidian-releases/commits?path=${PLUGIN_STATS_FILE}&per_page=`;

/** Prefix for the same file at an older commit, `<prefix><sha>/<file>`. */
export const STATS_AT_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/';

/**
 * Themes are not on that plane. There is no committed stats file for them —
 * `community-css-themes-stats.json` has never existed in the releases repo —
 * so the number lives behind a live endpoint instead: one object per theme,
 * `{ id, download }`, no timestamp, no history to read backwards.
 *
 * The upside is size: 80 KB against the plugins' 3 MB, so a theme check costs
 * almost nothing. The downside is that a theme curve has to be sampled here
 * and cannot be backfilled from anywhere.
 */
export const THEME_STATS_URL = 'https://releases.obsidian.md/stats/theme';

/**
 * The theme directory. 181 KB, and the only place a theme's repository is
 * written down. Themes have no `id`: the key is the display name — the same
 * string as the folder under `.obsidian/themes`, spaces and capitals included.
 */
export const THEME_INDEX_URL =
	'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json';

/** A theme's page, `<prefix><slug>`; see `themePageUrl` for the slug rules. */
export const THEME_PAGE_URL = 'https://community.obsidian.md/themes/';

/** The window the panel reads: a month is long enough to show a trend. */
export const HISTORY_DAYS = 30;

/** Enough for a year of a longer window later, small enough to save often. */
export const HISTORY_MAX_SAMPLES = 180;

/** A repository rename is rare; a week is as fresh as this needs to be. */
export const INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const REFRESH_HOURS_DEFAULT = 12;

export const STATUS_BAR_CLASS = 'census-status';

/** The right-sidebar view. Doubles as the saved layout key, so keep it stable. */
export const VIEW_TYPE_CENSUS = 'census-reading';
