import type { MediaKind } from './types';

const GAME_HLTB_TEMPLATE_FIELDS = ['main', 'main_plus_sides', 'perfectionist', 'completionist'];
const NUMERIC_HLTB_TEMPLATE_FIELDS = new Set(['main', 'main_plus_sides', 'perfectionist', 'completionist']);

export function getDefaultTemplateFields(kind: MediaKind): string[] {
    if (kind === 'games') {
        return [
            'type',
            'name',
            'poster',
            'posterHorizontal',
            'plot',
            'gameSeries',
            'genres',
            'platforms',
            'year',
            'released',
            'developers',
            'publishers',
            'userRating',
            'communityRating',
            'communityVotes',
            'communityRatingProvider',
            'status',
            'favorite',
            'owned',
            'count',
            'repeatable',
            'myPlatform',
            'integrationSource',
            'url',
        ];
    }

    if (kind === 'anime') return [
        'type',
        'name',
        'image',
        'imageHorizontal',
        'plot',
        'tags',
        'year',
        'studios',
        'format',
        'animeParts',
        'rating',
        'communityRating',
        'communityVotes',
        'communityRatingProvider',
        'status',
        'favorite',
        'integrationSource',
        'url',
    ];

    if (kind === 'movies') {
        return [
            'type',
            'name',
            'poster',
            'posterHorizontal',
            'plot',
            'genres',
            'year',
            'released',
            'runtime',
            'director',
            'actors',
            'rating',
            'communityRating',
            'communityVotes',
            'communityRatingProvider',
            'status',
            'favorite',
            'owned',
            'count',
            'repeatable',
            'integrationSource',
            'url',
        ];
    }

    if (kind === 'books') {
        return [
            'type',
            'name',
            'poster',
            'posterHorizontal',
            'plot',
            'bookSeries',
            'seriesPosition',
            'authors',
            'publisher',
            'genres',
            'tags',
            'year',
            'released',
            'pageCurrent',
            'pageTotal',
            'chapterCurrent',
            'chapterTotal',
            'rating',
            'communityRating',
            'communityVotes',
            'communityRatingProvider',
            'status',
            'favorite',
            'owned',
            'count',
            'repeatable',
            'illustrator',
            'integrationSource',
            'url',
        ];
    }

    if (kind === 'manga') {
        return [
            'type',
            'name',
            'poster',
            'posterHorizontal',
            'plot',
            'authors',
            'artists',
            'genres',
            'tags',
            'year',
            'chapterCurrent',
            'chapterTotal',
            'volumeCurrent',
            'volumeTotal',
            'mangaParts',
            'rating',
            'communityRating',
            'communityVotes',
            'communityRatingProvider',
            'status',
            'favorite',
            'integrationSource',
            'url',
        ];
    }

    return [
        'type',
        'name',
        'poster',
        'posterHorizontal',
        'plot',
        'genres',
        'year',
        'released',
        'runtime',
        'director',
        'actors',
        'seasons',
        'episodeCurrent',
        'episodeTotal',
        'tvParts',
        'rating',
        'communityRating',
        'communityVotes',
        'communityRatingProvider',
        'status',
        'favorite',
        'owned',
        'count',
        'repeatable',
        'integrationSource',
        'url',
    ];
}

export function getEffectiveSimpleTemplateFields(
    kind: MediaKind,
    fields: string[],
    options: { howLongToBeatEnabled?: boolean } = {}
): string[] {
    const allowed = new Set(getDefaultTemplateFields(kind));
    if (kind === 'games' && options.howLongToBeatEnabled) {
        GAME_HLTB_TEMPLATE_FIELDS.forEach((field) => allowed.add(field));
    }

    const normalized: string[] = [];
    for (const key of fields) {
        if (!allowed.has(key)) continue;
        const normalizedKey = key === 'completionist' ? 'perfectionist' : key;
        if (normalized.includes(normalizedKey)) continue;
        normalized.push(normalizedKey);
    }

    return normalized;
}

function getTemplateFieldForYamlKey(kind: MediaKind, yamlKey: string): string | undefined {
    // Both spellings are listed so this keeps resolving during and after the kebab-case
    // migration: notes and templates may hold either while stages roll out.
    const common: Record<string, string> = {
        type: 'type',
        synopsis: 'plot',
        plot: 'plot',
        year: 'year',
        rating: kind === 'games' ? 'userRating' : 'rating',
        status: 'status',
        favorite: 'favorite',
        'integration-provider': 'integrationSource',
        'integration-id': 'integrationSource',
        integration_provider: 'integrationSource',
        integration_id: 'integrationSource',
        'community-rating': 'communityRating',
        'community-votes': 'communityVotes',
        'community-rating-provider': 'communityRatingProvider',
        communityRating: 'communityRating',
        communityVotes: 'communityVotes',
        communityRatingProvider: 'communityRatingProvider',
        owned: 'owned',
        count: 'count',
        repeatable: 'repeatable',
        url: 'url',
    };
    const fieldsByKind: Record<MediaKind, Record<string, string>> = {
        games: {
            title: 'name',
            name: 'name',
            poster: 'poster',
            'poster-b': 'posterHorizontal',
            poster_b: 'posterHorizontal',
            series: 'gameSeries',
            gameSeries: 'gameSeries',
            genres: 'genres',
            platforms: 'platforms',
            released: 'released',
            author: 'developers',
            developers: 'developers',
            publishers: 'publishers',
            'user-rating': 'userRating',
            userRating: 'userRating',
            'hltb-main': 'main',
            'hltb-main-sides': 'main_plus_sides',
            'hltb-perfectionist': 'perfectionist',
            main: 'main',
            main_plus_sides: 'main_plus_sides',
            perfectionist: 'perfectionist',
            'my-platform': 'myPlatform',
        },
        anime: {
            title: 'name',
            image: 'image',
            image_b: 'imageHorizontal',
            tags: 'tags',
            studios: 'studios',
            format: 'format',
            season_current: 'animeParts',
            episode_current: 'animeParts',
            episode_total: 'animeParts',
            active_part_id: 'animeParts',
            anime_parts: 'animeParts',
        },
        movies: {
            title: 'name',
            poster: 'poster',
            'poster-b': 'posterHorizontal',
            poster_b: 'posterHorizontal',
            genres: 'genres',
            released: 'released',
            runtime: 'runtime',
            author: 'director',
            director: 'director',
            cast: 'actors',
            actors: 'actors',
            active_part_id: 'movieParts',
            movie_parts: 'movieParts',
        },
        tv: {
            title: 'name',
            poster: 'poster',
            'poster-b': 'posterHorizontal',
            poster_b: 'posterHorizontal',
            genres: 'genres',
            released: 'released',
            runtime: 'runtime',
            author: 'director',
            director: 'director',
            cast: 'actors',
            actors: 'actors',
            seasons: 'seasons',
            'episode-current': 'episodeCurrent',
            episode_current: 'episodeCurrent',
            episodes: 'episodeTotal',
            episode_total: 'episodeTotal',
            'season-id-current': 'tvParts',
            'season-data': 'tvParts',
            active_part_id: 'tvParts',
            series_parts: 'tvParts',
        },
        books: {
            title: 'name',
            poster: 'poster',
            'poster-b': 'posterHorizontal',
            poster_b: 'posterHorizontal',
            series: 'bookSeries',
            bookSeries: 'bookSeries',
            'series-position': 'seriesPosition',
            seriesPosition: 'seriesPosition',
            author: 'authors',
            authors: 'authors',
            publisher: 'publisher',
            genres: 'genres',
            tags: 'tags',
            released: 'released',
            illustrator: 'illustrator',
            'page-current': 'pageCurrent',
            'page-total': 'pageTotal',
            'chapter-current': 'chapterCurrent',
            'chapter-total': 'chapterTotal',
            page_current: 'pageCurrent',
            page_total: 'pageTotal',
            chapter_current: 'chapterCurrent',
            chapter_total: 'chapterTotal',
        },
        manga: {
            title: 'name',
            poster: 'poster',
            poster_b: 'posterHorizontal',
            authors: 'authors',
            artists: 'artists',
            genres: 'genres',
            tags: 'tags',
            chapter_current: 'chapterCurrent',
            chapter_total: 'chapterTotal',
            volume_current: 'volumeCurrent',
            volume_total: 'volumeTotal',
            active_part_id: 'mangaParts',
            manga_parts: 'mangaParts',
        },
    };

    return fieldsByKind[kind][yamlKey] ?? common[yamlKey];
}

function applySimpleTemplateFieldOrder(kind: MediaKind, fields: string[], lines: string[]): string[] {
    const fixedLines: string[] = [];
    const blocks: Array<{ field: string; index: number; lines: string[] }> = [];

    for (const line of lines) {
        // Hyphens are part of the key: the migrated templates emit kebab-case keys like
        // `poster-b`, which this would otherwise fail to recognise for ordering.
        const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
        const field = match ? getTemplateFieldForYamlKey(kind, match[1]) : undefined;
        if (!field) {
            if (blocks.length && !match) blocks[blocks.length - 1].lines.push(line);
            else fixedLines.push(line);
            continue;
        }

        blocks.push({ field, index: blocks.length, lines: [line] });
    }

    const order = new Map(fields.map((field, index) => [
        field === 'completionist' ? 'perfectionist' : field,
        index,
    ]));
    blocks.sort((left, right) => {
        const leftOrder = order.get(left.field) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = order.get(right.field) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.index - right.index;
    });

    const sortedLines = [...fixedLines];
    for (const block of blocks) sortedLines.push(...block.lines);
    return sortedLines;
}

/**
 * `kebab` is per-kind rather than global: games, movies, series and books were migrated
 * to lower-kebab-case keys, anime and manga were deliberately left out of that migration
 * and their services still read only the camelCase spellings.
 */
function appendCommunityRatingFields(set: Set<string>, lines: string[], kebab: boolean): void {
    const rating = kebab ? 'community-rating' : 'communityRating';
    const votes = kebab ? 'community-votes' : 'communityVotes';
    const provider = kebab ? 'community-rating-provider' : 'communityRatingProvider';
    if (set.has('communityRating')) lines.push(`${rating}: {{VALUE:communityRating}}`);
    if (set.has('communityVotes')) lines.push(`${votes}: {{VALUE:communityVotes}}`);
    if (set.has('communityRatingProvider')) {
        lines.push(`${provider}: "{{VALUE:communityRatingProvider}}"`);
    }
}

/** Emits the integration identity pair in the spelling the kind's service reads. */
function appendIntegrationSourceFields(lines: string[], kebab: boolean): void {
    lines.push(`${kebab ? 'integration-provider' : 'integration_provider'}: "{{VALUE:integrationProvider}}"`);
    lines.push(`${kebab ? 'integration-id' : 'integration_id'}: "{{VALUE:integrationId}}"`);
}

/**
 * Manual fields with no provider source.
 *
 * `owned` and `count` are deliberately NOT emitted: they should stay absent from a note
 * until actually set, rather than seeding every import with a meaningless "no" and 0.
 * `repeatable` is a boolean with a genuine default, so it behaves like `favorite: false`.
 */
function appendManualFields(set: Set<string>, lines: string[]): void {
    if (set.has('repeatable')) lines.push('repeatable: false');
}

export function buildSimpleTemplate(kind: MediaKind, fields: string[]): string {
    const set = new Set(fields);
    const lines: string[] = ['---'];
    // Games, movies, series and books were migrated to lower-kebab-case note keys.
    // Anime and manga were excluded from that migration and their services still read
    // only the legacy spellings, so they keep emitting the old keys.
    const kebab = kind === 'games' || kind === 'movies' || kind === 'tv' || kind === 'books';

    if (kind === 'games') {
        if (set.has('type')) lines.push('type: "game"');
        if (set.has('name')) lines.push('title: "{{VALUE:name}}"');
        if (set.has('poster')) lines.push('poster: "{{VALUE:Poster}}"');
        if (set.has('posterHorizontal')) lines.push('poster-b: "{{VALUE:PosterHorizontal}}"');
        if (set.has('plot')) lines.push('synopsis: "{{VALUE:Plot}}"');
        if (set.has('gameSeries')) lines.push('series: "{{VALUE:gameSeries}}"');
        if (set.has('genres')) lines.push('genres: "{{VALUE:genres}}"');
        if (set.has('platforms')) lines.push('platforms: "{{VALUE:platforms}}"');
        if (set.has('year')) lines.push('year: {{VALUE:Year}}');
        if (set.has('released')) lines.push('released: "{{VALUE:released}}"');
        if (set.has('developers')) lines.push('author: "{{VALUE:developers}}"');
        if (set.has('publishers')) lines.push('publishers: "{{VALUE:publishers}}"');
        if (set.has('userRating')) lines.push('user-rating: {{VALUE:userRating}}');
        appendCommunityRatingFields(set, lines, kebab);
        if (set.has('status')) lines.push('status: "{{VALUE:status}}"');
        if (set.has('favorite')) lines.push('favorite: false');
        appendManualFields(set, lines);
        if (set.has('integrationSource')) appendIntegrationSourceFields(lines, kebab);
        if (set.has('url')) lines.push('url: "{{VALUE:url}}"');
        if (set.has('main')) lines.push('hltb-main: {{VALUE:main}}');
        if (set.has('main_plus_sides')) lines.push('hltb-main-sides: {{VALUE:main_plus_sides}}');
        if (set.has('perfectionist') || set.has('completionist')) {
            lines.push('hltb-perfectionist: {{VALUE:perfectionist}}');
        }
    } else if (kind === 'anime') {
        if (set.has('type')) lines.push('type: "anime"');
        if (set.has('name')) lines.push('title: "{{VALUE:name}}"');
        if (set.has('image')) lines.push('image: "{{VALUE:image}}"');
        if (set.has('imageHorizontal')) lines.push('image_b: "{{VALUE:ImageHorizontal}}"');
        if (set.has('plot')) lines.push('plot: "{{VALUE:Plot}}"');
        if (set.has('tags')) lines.push('tags: "{{VALUE:tags}}"');
        if (set.has('year')) lines.push('year: {{VALUE:Year}}');
        if (set.has('studios')) lines.push('studios: "{{VALUE:studios}}"');
        if (set.has('format')) lines.push('format: "{{VALUE:format}}"');
        if (set.has('animeParts')) {
            lines.push('season_current: {{VALUE:seasonCurrent}}');
            lines.push('episode_current: {{VALUE:episodeCurrent}}');
            lines.push('episode_total: {{VALUE:episodeTotal}}');
            lines.push('active_part_id: "{{VALUE:activePartId}}"');
            lines.push('anime_parts:');
            lines.push('{{VALUE:animePartsYaml}}');
        }
        if (set.has('rating')) lines.push('rating: {{VALUE:rating}}');
        appendCommunityRatingFields(set, lines, kebab);
        if (set.has('status')) lines.push('status: "{{VALUE:status}}"');
        if (set.has('favorite')) lines.push('favorite: false');
        if (set.has('integrationSource')) appendIntegrationSourceFields(lines, kebab);
        if (set.has('url')) lines.push('url: "{{VALUE:url}}"');
    } else if (kind === 'movies' || kind === 'tv') {
        if (set.has('type')) lines.push(`type: "${kind === 'movies' ? 'movie' : 'tv'}"`);
        if (set.has('name')) lines.push('title: "{{VALUE:name}}"');
        if (set.has('poster')) lines.push('poster: "{{VALUE:Poster}}"');
        if (set.has('posterHorizontal')) lines.push('poster-b: "{{VALUE:PosterHorizontal}}"');
        if (set.has('plot')) lines.push('synopsis: "{{VALUE:Plot}}"');
        if (set.has('genres')) lines.push('genres: "{{VALUE:genres}}"');
        if (set.has('year')) lines.push('year: {{VALUE:Year}}');
        if (kind === 'movies') {
            if (set.has('released')) lines.push('released: {{VALUE:released}}');
            if (set.has('runtime')) lines.push('runtime: {{VALUE:runtime}}');
            if (set.has('director')) lines.push('author: "{{VALUE:directors}}"');
            if (set.has('actors')) lines.push('cast: "{{VALUE:actors}}"');
            // Movie parts are intentionally not emitted: they were discarded from the
            // library during the migration and are not a concept in use.
        } else {
            if (set.has('released')) lines.push('released: {{VALUE:released}}');
            if (set.has('runtime')) lines.push('runtime: {{VALUE:runtime}}');
            if (set.has('director')) lines.push('author: "{{VALUE:directors}}"');
            if (set.has('actors')) lines.push('cast: "{{VALUE:actors}}"');
            if (set.has('seasons')) lines.push('seasons: {{VALUE:seasons}}');
            if (set.has('episodeCurrent')) lines.push('episode-current: {{VALUE:episodeCurrent}}');
            if (set.has('episodeTotal')) lines.push('episodes: {{VALUE:episodeTotal}}');
            if (set.has('tvParts')) {
                lines.push('season-id-current: "{{VALUE:activePartId}}"');
                lines.push('season-data:');
                lines.push('{{VALUE:videoPartsYaml}}');
            }
        }
        if (set.has('rating')) lines.push('rating: {{VALUE:rating}}');
        appendCommunityRatingFields(set, lines, kebab);
        if (set.has('status')) lines.push('status: "{{VALUE:status}}"');
        if (set.has('favorite')) lines.push('favorite: false');
        appendManualFields(set, lines);
        if (set.has('integrationSource')) appendIntegrationSourceFields(lines, kebab);
        if (set.has('url')) lines.push('url: "{{VALUE:url}}"');
    } else {
        if (set.has('type')) lines.push(`type: "${kind === 'books' ? 'book' : 'manga'}"`);
        if (set.has('name')) lines.push('title: "{{VALUE:name}}"');
        if (set.has('poster')) lines.push('poster: "{{VALUE:Poster}}"');
        if (set.has('posterHorizontal')) lines.push(`${kebab ? 'poster-b' : 'poster_b'}: "{{VALUE:PosterHorizontal}}"`);
        if (set.has('plot')) lines.push(`${kebab ? 'synopsis' : 'plot'}: "{{VALUE:Plot}}"`);
        if (kind === 'books' && set.has('bookSeries')) lines.push('series: "{{VALUE:bookSeries}}"');
        if (kind === 'books' && set.has('seriesPosition')) lines.push('series-position: {{VALUE:seriesPosition}}');
        if (set.has('authors')) lines.push(`${kebab ? 'author' : 'authors'}: "{{VALUE:authors}}"`);
        if (kind === 'manga' && set.has('artists')) lines.push('artists: "{{VALUE:artists}}"');
        if (kind === 'books' && set.has('publisher')) lines.push('publisher: "{{VALUE:publisher}}"');
        if (set.has('genres')) lines.push('genres: "{{VALUE:genres}}"');
        if (set.has('tags')) lines.push('tags: "{{VALUE:tags}}"');
        if (set.has('year')) lines.push('year: {{VALUE:Year}}');
        if (kind === 'books') {
            if (set.has('released')) lines.push('released: {{VALUE:released}}');
            if (set.has('pageCurrent')) lines.push('page-current: {{VALUE:pageCurrent}}');
            if (set.has('pageTotal')) lines.push('page-total: {{VALUE:pageTotal}}');
            if (set.has('chapterCurrent')) lines.push('chapter-current: {{VALUE:chapterCurrent}}');
            if (set.has('chapterTotal')) lines.push('chapter-total: {{VALUE:chapterTotal}}');
        } else {
            if (set.has('chapterCurrent')) lines.push('chapter_current: {{VALUE:chapterCurrent}}');
            if (set.has('chapterTotal')) lines.push('chapter_total: {{VALUE:chapterTotal}}');
            if (set.has('volumeCurrent')) lines.push('volume_current: {{VALUE:volumeCurrent}}');
            if (set.has('volumeTotal')) lines.push('volume_total: {{VALUE:volumeTotal}}');
            if (set.has('mangaParts')) {
                lines.push('active_part_id: "{{VALUE:activePartId}}"');
                lines.push('manga_parts:');
                lines.push('{{VALUE:mangaPartsYaml}}');
            }
        }
        if (set.has('rating')) lines.push('rating: {{VALUE:rating}}');
        appendCommunityRatingFields(set, lines, kebab);
        if (set.has('status')) lines.push('status: "{{VALUE:status}}"');
        if (set.has('favorite')) lines.push('favorite: false');
        if (kind === 'books') {
            appendManualFields(set, lines);
        }
        if (set.has('integrationSource')) appendIntegrationSourceFields(lines, kebab);
        if (set.has('url')) lines.push('url: "{{VALUE:url}}"');
    }

    const orderedLines = applySimpleTemplateFieldOrder(kind, fields, lines);
    orderedLines.push('---');
    return orderedLines.join('\n');
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
    const lines = template.split(/\r?\n/);
    const output: string[] = [];
    const placeholderRegex = /\{\{VALUE:([A-Za-z0-9_]+)\}\}/g;

    for (const line of lines) {
        const match = line.match(/\{\{VALUE:([A-Za-z0-9_]+)\}\}/);
        if (!match) {
            output.push(line);
            continue;
        }

        const key = match[1];
        const value = values[key];
        if (typeof value === 'string' && value.includes('\n') && line.trim() === `{{VALUE:${key}}}`) {
            output.push(value);
            continue;
        }

        if (NUMERIC_HLTB_TEMPLATE_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
            const numericKeyMatch = line.match(
                /^(\s*[^:]+:\s*)"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/
            );
            if (numericKeyMatch) {
                output.push(`${numericKeyMatch[1]}${value}`);
                continue;
            }
        }

        if (key === 'released' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const dateKeyMatch = line.match(
                /^(\s*[^:]+:\s*)"?\{\{VALUE:released\}\}"?\s*$/
            );
            if (dateKeyMatch) {
                output.push(`${dateKeyMatch[1]}${value}`);
                continue;
            }
        }

        if (Array.isArray(value)) {
            const listItemMatch = line.match(/^(\s*)-\s*"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/);
            if (listItemMatch) {
                const indent = listItemMatch[1];
                if (!value.length) {
                    output.push(`${indent}[]`);
                    continue;
                }
                for (const item of value) {
                    output.push(`${indent}- "${escapeYaml(item)}"`);
                }
                continue;
            }

            const keyMatch = line.match(/^(\s*)([^:]+):\s*"?\{\{VALUE:[A-Za-z0-9_]+\}\}"?\s*$/);
            if (keyMatch) {
                const indent = keyMatch[1];
                const keyName = keyMatch[2].trim();
                if (!value.length) {
                    output.push(`${indent}${keyName}: []`);
                    continue;
                }
                output.push(`${indent}${keyName}:`);
                const childIndent = `${indent}  `;
                for (const item of value) {
                    output.push(`${childIndent}- "${escapeYaml(item)}"`);
                }
                continue;
            }
        }

        const replaced = line.replace(placeholderRegex, (_: string, k: string) => {
            const raw = values[k];
            if (Array.isArray(raw)) {
                return raw.map((v) => escapeYaml(v)).join(', ');
            }
            return escapeYaml(toStringSafe(raw));
        });
        output.push(replaced);
    }

    return output.join('\n');
}

/**
 * Provider identity is operational metadata rather than an optional display
 * field. Keep it in frontmatter even when a device still has an older custom
 * template that predates the integration source fields.
 */
export function ensureIntegrationSourceFrontmatter(
    content: string,
    provider: string,
    id: string
): string {
    const safeProvider = escapeYaml(provider.trim());
    const safeId = escapeYaml(id.trim());
    if (!safeProvider || !safeId) return content;

    const sourceLines = [
        `integration_provider: "${safeProvider}"`,
        `integration_id: "${safeId}"`,
    ];
    const frontmatterMatch = content.match(/^(\uFEFF?[ \t]*---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
    if (!frontmatterMatch) {
        return `---\n${sourceLines.join('\n')}\n---\n${content}`;
    }

    const bodyLines = frontmatterMatch[2].split(/\r?\n/);
    const replaceOrAppend = (key: string, line: string): void => {
        const index = bodyLines.findIndex((candidate) => new RegExp(`^\\s*${key}\\s*:`).test(candidate));
        if (index >= 0) bodyLines[index] = line;
        else bodyLines.push(line);
    };
    replaceOrAppend('integration_provider', sourceLines[0]);
    replaceOrAppend('integration_id', sourceLines[1]);

    return `${frontmatterMatch[1]}${bodyLines.join('\n')}${frontmatterMatch[3]}${content.slice(frontmatterMatch[0].length)}`;
}

export function sanitizeFileName(name: string): string {
    return name.replace(/[*\\/<>:|?"]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeYaml(value: unknown): string {
    const text = toStringSafe(value);
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

function toStringSafe(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}
