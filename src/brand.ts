/**
 * Obsidian's own mark, for the link that leaves the panel.
 *
 * Every other icon in the plugin comes from Obsidian's icon set, but there is
 * no Obsidian icon in it -- `gem` was the closest stand-in and still read as a
 * diamond. So this is the real logo, taken from the official 512-unit SVG and
 * cut down to its silhouette: at 14px the facets and gradients on the other
 * paths are noise, and the lit facet only greyed the upper half out.
 */
export const OBSIDIAN_MARK_BODY =
	'M382.3 475.6c-3.1 23.4-26 41.6-48.7 35.3-32.4-8.9-69.9-22.8-103.6-25.4l-51.7-4a34 34 0 0 1-22-10.2l-89-91.7a34 34 0 0 1-6.7-37.7s55-121 57.1-127.3c2-6.3 9.6-61.2 14-90.6 1.2-7.9 5-15 11-20.3L248 8.9a34.1 34.1 0 0 1 49.6 4.3L386 125.6a37 37 0 0 1 7.6 22.4c0 21.3 1.8 65 13.6 93.2 11.5 27.3 32.5 57 43.5 71.5a17.3 17.3 0 0 1 1.3 19.2 1494 1494 0 0 1-44.8 70.6c-15 22.3-21.9 49.9-25 73.1z';

/**
 * Cropped to the artwork rather than to the source's 0..512 square: the shape
 * sits at x 60..436 and y 9..511, so it is narrower than it is tall. At 14px
 * every unit of dead margin is a unit of crystal lost.
 */
/**
 * Two of the back facets, drawn in black over the body.
 *
 * The silhouette on its own is a rounded stone -- at 14px it is not obviously
 * a crystal at all, because the official logo gets its shape from layered
 * light, not from its outline. Darkening two facets restores one hard edge
 * down the middle, which is the cheapest thing that makes it read as faceted.
 * Black rather than a second grey so it also works on light themes, where the
 * same overlay simply goes darker instead of lighter.
 */
export const OBSIDIAN_MARK_FACET_RIGHT =
	'M278.4 307.8c11.2 1.2 22.2 3.6 32.8 7.6 34 12.7 65 41.2 90.5 96.3 1.8-3.1 3.6-6.2 5.6-9.2a1536 1536 0 0 0 44.8-70.6 17 17 0 0 0-1.3-19.2c-11-14.6-32-44.2-43.5-71.5-11.8-28.2-13.5-72-13.6-93.2 0-8.1-2.6-16-7.6-22.4L297.6 13.2a34 34 0 0 0-1.5-1.7 96 96 0 0 1 2 54 198.3 198.3 0 0 1-17.6 41.3l-7.2 14.2a171 171 0 0 0-19.4 71c-1.2 29.4 4.8 66.4 24.5 115.8z';

export const OBSIDIAN_MARK_FACET_LEFT =
	'M165.9 478.3c41.4-84 40.2-144.2 22.6-187-16.2-39.6-46.3-64.5-70-80-.6 2.3-1.3 4.4-2.2 6.5L60.6 342a34 34 0 0 0 6.6 37.7l89.1 91.7a34 34 0 0 0 9.6 7z';

export const OBSIDIAN_MARK_VIEWBOX = '-8 4 512 512';

/**
 * GitHub's octocat, solid.
 *
 * Obsidian's icon set ships a stroked version (lucide), and next to a filled
 * crystal it read as a different kind of thing: one a silhouette, the other a
 * wireframe. Two marks in one row have to be drawn the same way, and a solid
 * silhouette is also the one that survives 13px. This is GitHub's own 16-unit
 * mark, which is what the brand actually looks like.
 */
export const GITHUB_MARK_BODY =
	'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z';

export const GITHUB_MARK_VIEWBOX = '0 0 16 16';
