/**
 * LOREBASE - Field registry
 *
 * One declaration per frontmatter field per media kind: the YAML key a note carries, the
 * spellings it replaced, the provider field enrichment sends for it, and how the simple
 * template emits it. Before this, each fact lived in six or seven hand-synced places
 * (template builder, key-to-field map, default and settings field lists, enrichment
 * aliases, readers, writers), and most follow-up bugs were one of them being missed.
 *
 * Order matters: a kind's template fields appear here in settings order, which is also
 * the order their lines are emitted in.
 */

import type { TranslationKey } from '../localization';
import type { MediaKind } from '../services/integrations/types';

export interface TemplateSpec {
    /** Settings checkbox label. */
    label: TranslationKey;
    /**
     * Exact lines the simple template emits. Empty for manual fields, which stay absent
     * from a note until the user sets them.
     */
    lines: string[];
    /** Selected in a fresh install's default field list. */
    defaultOn: boolean;
    /** Only offered when HowLongToBeat is enabled (games). */
    hltb?: boolean;
    /**
     * Still listed in settings and the default selection for compatibility, but the
     * generator drops it, so ticking it does nothing.
     */
    retired?: boolean;
}

/**
 * How a simple field maps onto the parsed item. Fields with real logic (status, parts,
 * images, dates, lists) leave this out and are read and written by their service.
 */
export interface ItemBinding {
    /** Property on the parsed item. */
    prop: string;
    /** `text` is null when empty, `textOrEmpty` is ''. */
    read: 'text' | 'textOrEmpty' | 'number' | 'boolean';
    /**
     * How an edited value is stored: as given, empty to null, empty to '', missing to
     * false, missing to null, or as trimmed text with empty to null.
     */
    write: 'raw' | 'orNull' | 'orEmpty' | 'orFalse' | 'nullish' | 'trimmed';
}

export interface FieldSpec {
    /** Unique within its kind; the template field id when the field has a template. */
    name: string;
    /** YAML keys the field owns, primary first. */
    keys: string[];
    /**
     * Older spellings, cleared when the field is written. A list belongs to the primary
     * key; fields owning several keys map each key to its own older spellings.
     */
    legacyKeys?: string[] | Record<string, string[]>;
    item?: ItemBinding;
    /** Provider field name (as enrichment receives it) mapped to the YAML key it fills. */
    provider?: Record<string, string>;
    template?: TemplateSpec;
}

type Spec = FieldSpec;

// ---------------------------------------------------------------------------------------
// Builders for fields that repeat across kinds. Each takes the kind's key spelling where
// games, movies, TV and books (migrated to kebab-case) differ from anime and manga (not).
// ---------------------------------------------------------------------------------------

const typeField = (value: string): Spec => ({
    name: 'type',
    keys: ['type'],
    template: { label: 'templateFieldType', lines: [`type: "${value}"`], defaultOn: true },
});

const nameField = (): Spec => ({
    name: 'name',
    keys: ['title'],
    legacyKeys: ['name'],
    provider: { name: 'title' },
    template: { label: 'templateFieldName', lines: ['title: "{{VALUE:name}}"'], defaultOn: true },
});

const posterField = (): Spec => ({
    name: 'poster',
    keys: ['poster'],
    provider: { poster: 'poster' },
    template: { label: 'templateFieldPoster', lines: ['poster: "{{VALUE:Poster}}"'], defaultOn: true },
});

const posterHorizontalField = (key: 'poster-b' | 'poster_b'): Spec => ({
    name: 'posterHorizontal',
    keys: [key],
    legacyKeys: key === 'poster-b' ? ['poster_b'] : undefined,
    provider: { poster_b: key },
    template: {
        label: 'templateFieldPosterHorizontal',
        lines: [`${key}: "{{VALUE:PosterHorizontal}}"`],
        defaultOn: true,
    },
});

const plotField = (key: 'synopsis' | 'plot'): Spec => ({
    name: 'plot',
    keys: [key],
    legacyKeys: key === 'synopsis' ? ['plot'] : undefined,
    provider: { plot: key },
    template: { label: 'templateFieldPlot', lines: [`${key}: "{{VALUE:Plot}}"`], defaultOn: true },
});

const quotedListField = (name: string, label: TranslationKey, key = name): Spec => ({
    name,
    keys: [key],
    provider: { [name]: key },
    template: { label, lines: [`${key}: "{{VALUE:${name}}}"`], defaultOn: true },
});

const yearField = (): Spec => ({
    name: 'year',
    keys: ['year'],
    provider: { year: 'year' },
    template: { label: 'templateFieldYear', lines: ['year: {{VALUE:Year}}'], defaultOn: true },
});

const releasedField = (quoted: boolean): Spec => ({
    name: 'released',
    keys: ['released'],
    provider: { released: 'released' },
    template: {
        label: 'templateFieldReleased',
        // Games quote the release date; movies, TV and books do not.
        lines: [quoted ? 'released: "{{VALUE:released}}"' : 'released: {{VALUE:released}}'],
        defaultOn: true,
    },
});

const ratingField = (): Spec => ({
    name: 'rating',
    keys: ['rating'],
    template: { label: 'templateFieldRating', lines: ['rating: {{VALUE:rating}}'], defaultOn: true },
});

const communityFields = (kebab: boolean): Spec[] => {
    const rating = kebab ? 'community-rating' : 'communityRating';
    const votes = kebab ? 'community-votes' : 'communityVotes';
    const provider = kebab ? 'community-rating-provider' : 'communityRatingProvider';
    return [
        {
            name: 'communityRating',
            keys: [rating],
            legacyKeys: kebab ? ['communityRating'] : undefined,
            provider: { communityRating: rating },
            template: { label: 'templateFieldCommunityRating', lines: [`${rating}: {{VALUE:communityRating}}`], defaultOn: true },
        },
        {
            name: 'communityVotes',
            keys: [votes],
            legacyKeys: kebab ? ['communityVotes'] : undefined,
            provider: { communityVotes: votes },
            template: { label: 'templateFieldCommunityVotes', lines: [`${votes}: {{VALUE:communityVotes}}`], defaultOn: true },
        },
        {
            name: 'communityRatingProvider',
            keys: [provider],
            legacyKeys: kebab ? ['communityRatingProvider'] : undefined,
            provider: { communityRatingProvider: provider },
            template: {
                label: 'templateFieldCommunityRatingProvider',
                lines: [`${provider}: "{{VALUE:communityRatingProvider}}"`],
                defaultOn: true,
            },
        },
    ];
};

const statusField = (): Spec => ({
    name: 'status',
    keys: ['status'],
    template: { label: 'templateFieldStatus', lines: ['status: "{{VALUE:status}}"'], defaultOn: true },
});

const favoriteField = (): Spec => ({
    name: 'favorite',
    keys: ['favorite'],
    template: { label: 'templateFieldFavorite', lines: ['favorite: false'], defaultOn: true },
});

/**
 * Manual fields with no provider source. `owned` and `count` emit nothing, so they stay
 * absent from a note until actually set; `repeatable` has a genuine default, like
 * `favorite: false`.
 */
const manualFields = (options: { ownedDefaultOn?: boolean } = {}): Spec[] => [
    {
        name: 'owned',
        keys: ['owned'],
        // Games' default list gained `owned` for Steam wishlist imports (fdb7971); since
        // 1e99f26 Steam Sync writes it itself, so the default no longer needs it.
        template: { label: 'templateFieldOwned', lines: [], defaultOn: options.ownedDefaultOn ?? false },
    },
    {
        name: 'count',
        keys: ['count'],
        template: { label: 'templateFieldCount', lines: [], defaultOn: false },
    },
    {
        name: 'repeatable',
        keys: ['repeatable'],
        template: { label: 'templateFieldRepeatable', lines: ['repeatable: false'], defaultOn: false },
    },
];

const integrationSourceField = (kebab: boolean): Spec => {
    const provider = kebab ? 'integration-provider' : 'integration_provider';
    const id = kebab ? 'integration-id' : 'integration_id';
    return {
        name: 'integrationSource',
        keys: [provider, id],
        legacyKeys: kebab ? { [provider]: ['integration_provider'], [id]: ['integration_id'] } : undefined,
        provider: { integration_provider: provider, integration_id: id },
        template: {
            label: 'templateFieldIntegrationSource',
            lines: [`${provider}: "{{VALUE:integrationProvider}}"`, `${id}: "{{VALUE:integrationId}}"`],
            defaultOn: true,
        },
    };
};

const urlField = (): Spec => ({
    name: 'url',
    keys: ['url'],
    provider: { url: 'url' },
    template: { label: 'templateFieldUrl', lines: ['url: "{{VALUE:url}}"'], defaultOn: true },
});

const bind = (field: Spec, item: ItemBinding): Spec => ({ ...field, item });

const bindCommunity = (fields: Spec[]): Spec[] => fields.map((field) => bind(field, {
    prop: field.name,
    read: field.name === 'communityRatingProvider' ? 'text' : 'number',
    write: 'raw',
}));

const bindManual = (fields: Spec[]): Spec[] => fields.map((field) => {
    if (field.name === 'owned') return bind(field, { prop: 'owned', read: 'text', write: 'orNull' });
    if (field.name === 'count') return bind(field, { prop: 'count', read: 'number', write: 'nullish' });
    return bind(field, { prop: 'repeatable', read: 'boolean', write: 'orFalse' });
});

// ---------------------------------------------------------------------------------------
// Per-kind registries
// ---------------------------------------------------------------------------------------

const GAME_FIELDS: Spec[] = [
    typeField('game'),
    nameField(),
    posterField(),
    posterHorizontalField('poster-b'),
    bind(plotField('synopsis'), { prop: 'description', read: 'textOrEmpty', write: 'raw' }),
    {
        name: 'gameSeries',
        keys: ['series'],
        legacyKeys: ['gameSeries'],
        item: { prop: 'gameSeries', read: 'textOrEmpty', write: 'orEmpty' },
        provider: { gameSeries: 'series' },
        template: { label: 'templateFieldGameSeries', lines: ['series: "{{VALUE:gameSeries}}"'], defaultOn: true },
    },
    { ...quotedListField('genres', 'templateFieldGenres'), legacyKeys: ['genre'] },
    { ...quotedListField('platforms', 'templateFieldPlatforms'), legacyKeys: ['platform'] },
    yearField(),
    { ...releasedField(true), legacyKeys: ['releaseDate', 'release_date'] },
    {
        name: 'developers',
        keys: ['author'],
        legacyKeys: ['developers', 'developer'],
        provider: { developers: 'author' },
        template: { label: 'templateFieldDevelopers', lines: ['author: "{{VALUE:developers}}"'], defaultOn: true },
    },
    { ...quotedListField('publishers', 'templateFieldPublishers'), legacyKeys: ['publisher'] },
    {
        name: 'userRating',
        keys: ['user-rating'],
        legacyKeys: ['userRating'],
        template: { label: 'templateFieldUserRating', lines: ['user-rating: {{VALUE:userRating}}'], defaultOn: true },
    },
    ...bindCommunity(communityFields(true)),
    statusField(),
    bind(favoriteField(), { prop: 'favorite', read: 'boolean', write: 'raw' }),
    ...bindManual(manualFields({ ownedDefaultOn: true })),
    {
        name: 'myPlatform',
        keys: ['my-platform'],
        item: { prop: 'myPlatform', read: 'textOrEmpty', write: 'orNull' },
        template: { label: 'templateFieldMyPlatform', lines: [], defaultOn: false },
    },
    integrationSourceField(true),
    bind(urlField(), { prop: 'sourceUrl', read: 'text', write: 'orNull' }),
    {
        name: 'main',
        keys: ['hltb-main'],
        legacyKeys: ['main'],
        provider: { main: 'hltb-main' },
        template: { label: 'templateFieldMain', lines: ['hltb-main: {{VALUE:main}}'], defaultOn: false, hltb: true },
    },
    {
        name: 'main_plus_sides',
        keys: ['hltb-main-sides'],
        legacyKeys: ['main_plus_sides'],
        provider: { main_plus_sides: 'hltb-main-sides' },
        template: { label: 'templateFieldMainPlusSides', lines: ['hltb-main-sides: {{VALUE:main_plus_sides}}'], defaultOn: false, hltb: true },
    },
    {
        name: 'perfectionist',
        keys: ['hltb-perfectionist'],
        legacyKeys: ['perfectionist'],
        provider: { perfectionist: 'hltb-perfectionist' },
        template: { label: 'templateFieldCompletionist', lines: ['hltb-perfectionist: {{VALUE:perfectionist}}'], defaultOn: false, hltb: true },
    },
    // No template: written by Steam Sync and enrichment only.
    {
        name: 'steamAppId',
        keys: ['steam-app-id'],
        legacyKeys: ['steamAppId'],
        item: { prop: 'steamAppId', read: 'text', write: 'raw' },
        provider: { steamAppId: 'steam-app-id' },
    },
    // No template: personal fields and structured lists the editor owns.
    { name: 'tags', keys: ['tags'], legacyKeys: ['tag'] },
    { name: 'started', keys: ['started'] },
    { name: 'finished', keys: ['finished'], legacyKeys: ['dateCompleted', 'completionDate'] },
    { name: 'dlc', keys: ['dlc'] },
    { name: 'relatedMedia', keys: ['related-media'], legacyKeys: ['related_media'] },
];

const ANIME_FIELDS: Spec[] = [
    typeField('anime'),
    nameField(),
    {
        name: 'image',
        keys: ['image'],
        template: { label: 'templateFieldImage', lines: ['image: "{{VALUE:image}}"'], defaultOn: true },
    },
    {
        name: 'imageHorizontal',
        keys: ['image_b'],
        template: { label: 'templateFieldImageHorizontal', lines: ['image_b: "{{VALUE:ImageHorizontal}}"'], defaultOn: true },
    },
    plotField('plot'),
    quotedListField('tags', 'templateFieldTags'),
    yearField(),
    quotedListField('studios', 'templateFieldStudios'),
    {
        name: 'format',
        keys: ['format'],
        template: { label: 'templateFieldFormat', lines: ['format: "{{VALUE:format}}"'], defaultOn: true },
    },
    {
        name: 'animeParts',
        keys: ['anime_parts', 'active_part_id', 'season_current', 'episode_current', 'episode_total'],
        template: {
            label: 'templateFieldAnimeParts',
            lines: [
                'season_current: {{VALUE:seasonCurrent}}',
                'episode_current: {{VALUE:episodeCurrent}}',
                'episode_total: {{VALUE:episodeTotal}}',
                'active_part_id: "{{VALUE:activePartId}}"',
                'anime_parts:',
                '{{VALUE:animePartsYaml}}',
            ],
            defaultOn: true,
        },
    },
    ratingField(),
    ...communityFields(false),
    statusField(),
    favoriteField(),
    integrationSourceField(false),
    urlField(),
    // No template: a provider total enrichment fills in.
    { name: 'seasonTotal', keys: ['season_total'], provider: { season_total: 'season_total' } },
];

const videoFields = (kind: 'movies' | 'tv'): Spec[] => [
    typeField(kind === 'movies' ? 'movie' : 'tv'),
    nameField(),
    { ...posterField(), legacyKeys: ['image'] },
    { ...posterHorizontalField('poster-b'), legacyKeys: ['poster_b', 'image_b', 'horizontal_poster'] },
    bind(
        { ...plotField('synopsis'), legacyKeys: ['plot', 'summary', 'description'] },
        { prop: 'description', read: 'textOrEmpty', write: 'trimmed' }
    ),
    { ...quotedListField('genres', 'templateFieldGenres'), legacyKeys: ['genre'] },
    yearField(),
    { ...releasedField(false), legacyKeys: ['release_date', 'releaseDate'] },
    {
        name: 'runtime',
        keys: ['runtime'],
        item: { prop: 'runtime', read: 'textOrEmpty', write: 'trimmed' },
        template: { label: 'templateFieldRuntime', lines: ['runtime: {{VALUE:runtime}}'], defaultOn: true },
    },
    {
        name: 'director',
        keys: ['author'],
        legacyKeys: ['director', 'directors'],
        provider: { director: 'author' },
        template: { label: 'templateFieldDirector', lines: ['author: "{{VALUE:directors}}"'], defaultOn: true },
    },
    {
        name: 'actors',
        keys: ['cast'],
        legacyKeys: ['actors'],
        provider: { actors: 'cast' },
        template: { label: 'templateFieldActors', lines: ['cast: "{{VALUE:actors}}"'], defaultOn: true },
    },
    ...(kind === 'tv' ? tvOnlyFields() : []),
    bind(
        { ...ratingField(), legacyKeys: ['scoreImdb', 'imdbRating'] },
        { prop: 'rating', read: 'textOrEmpty', write: 'trimmed' }
    ),
    ...bindCommunity(communityFields(true)),
    statusField(),
    bind(favoriteField(), { prop: 'favorite', read: 'boolean', write: 'raw' }),
    ...bindManual(manualFields()),
    ...(kind === 'movies' ? [movieParts()] : []),
    integrationSourceField(true),
    bind({ ...urlField(), legacyKeys: ['source_url'] }, { prop: 'sourceUrl', read: 'textOrEmpty', write: 'trimmed' }),
    // No template: personal fields and structured lists the editor owns.
    { name: 'userRating', keys: ['user-rating'], legacyKeys: ['userRating', 'rating_user'] },
    { name: 'tags', keys: ['tags'], legacyKeys: ['tag'] },
    { name: 'started', keys: ['started'] },
    { name: 'finished', keys: ['finished'] },
    { name: 'relatedMedia', keys: ['related-media'], legacyKeys: ['related_media'] },
];

const tvOnlyFields = (): Spec[] => [
    {
        name: 'seasons',
        keys: ['seasons'],
        template: { label: 'templateFieldSeasons', lines: ['seasons: {{VALUE:seasons}}'], defaultOn: true },
    },
    {
        name: 'episodeCurrent',
        keys: ['episode-current'],
        legacyKeys: ['episode_current'],
        template: { label: 'templateFieldEpisodeCurrent', lines: ['episode-current: {{VALUE:episodeCurrent}}'], defaultOn: true },
    },
    {
        name: 'episodeTotal',
        keys: ['episodes'],
        legacyKeys: ['episode_total'],
        provider: { episode_total: 'episodes' },
        template: { label: 'templateFieldEpisodeTotal', lines: ['episodes: {{VALUE:episodeTotal}}'], defaultOn: true },
    },
    {
        name: 'tvParts',
        keys: ['season-data', 'season-id-current'],
        legacyKeys: { 'season-data': ['series_parts', 'tv_parts'], 'season-id-current': ['active_part_id'] },
        provider: { tv_parts: 'season-data' },
        template: {
            label: 'templateFieldTvParts',
            lines: ['season-id-current: "{{VALUE:activePartId}}"', 'season-data:', '{{VALUE:videoPartsYaml}}'],
            defaultOn: true,
        },
    },
];

/** Movie parts were discarded from the library during the migration. */
const movieParts = (): Spec => ({
    name: 'movieParts',
    keys: ['movie_parts'],
    template: { label: 'templateFieldMovieParts', lines: [], defaultOn: true, retired: true },
});

const TV_EXTRA_FIELDS: Spec[] = [
    // No template: written by enrichment, the editor and the new-season check.
    { name: 'networks', keys: ['networks'], legacyKeys: ['network'], provider: { networks: 'networks' } },
    { name: 'showStatus', keys: ['show-status'], provider: { showStatus: 'show-status' } },
    { name: 'seasonCurrent', keys: ['season-current'], legacyKeys: ['season_current'] },
];

const BOOK_FIELDS: Spec[] = [
    typeField('book'),
    nameField(),
    { ...posterField(), legacyKeys: ['image'] },
    { ...posterHorizontalField('poster-b'), legacyKeys: ['poster_b', 'image_b', 'horizontal_poster'] },
    bind(
        { ...plotField('synopsis'), legacyKeys: ['plot', 'summary', 'description'] },
        { prop: 'description', read: 'textOrEmpty', write: 'trimmed' }
    ),
    {
        name: 'bookSeries',
        keys: ['series'],
        legacyKeys: ['bookSeries'],
        item: { prop: 'bookSeries', read: 'textOrEmpty', write: 'trimmed' },
        provider: { bookSeries: 'series' },
        template: { label: 'templateFieldBookSeries', lines: ['series: "{{VALUE:bookSeries}}"'], defaultOn: true },
    },
    {
        name: 'seriesPosition',
        keys: ['series-position'],
        legacyKeys: ['seriesPosition'],
        item: { prop: 'seriesPosition', read: 'number', write: 'nullish' },
        provider: { seriesPosition: 'series-position' },
        template: { label: 'templateFieldSeriesPosition', lines: ['series-position: {{VALUE:seriesPosition}}'], defaultOn: true },
    },
    {
        name: 'authors',
        keys: ['author'],
        legacyKeys: ['authors'],
        provider: { authors: 'author' },
        template: { label: 'templateFieldAuthors', lines: ['author: "{{VALUE:authors}}"'], defaultOn: true },
    },
    // One publisher is stored as text, several as a list; the reader joins either.
    { ...quotedListField('publisher', 'templateFieldPublisher'), legacyKeys: ['publishers'] },
    { ...quotedListField('genres', 'templateFieldGenres'), legacyKeys: ['genre'] },
    { ...quotedListField('tags', 'templateFieldTags'), legacyKeys: ['tag'] },
    yearField(),
    { ...releasedField(false), legacyKeys: ['release_date', 'publishedDate'] },
    {
        name: 'pageCurrent',
        keys: ['page-current'],
        legacyKeys: ['page_current'],
        template: { label: 'templateFieldPageCurrent', lines: ['page-current: {{VALUE:pageCurrent}}'], defaultOn: true },
    },
    {
        name: 'pageTotal',
        keys: ['page-total'],
        legacyKeys: ['page_total'],
        provider: { page_total: 'page-total' },
        template: { label: 'templateFieldPageTotal', lines: ['page-total: {{VALUE:pageTotal}}'], defaultOn: true },
    },
    {
        name: 'chapterCurrent',
        keys: ['chapter-current'],
        legacyKeys: ['chapter_current'],
        template: { label: 'templateFieldChapterCurrent', lines: ['chapter-current: {{VALUE:chapterCurrent}}'], defaultOn: true },
    },
    {
        name: 'chapterTotal',
        keys: ['chapter-total'],
        legacyKeys: ['chapter_total'],
        provider: { chapter_total: 'chapter-total' },
        template: { label: 'templateFieldChapterTotal', lines: ['chapter-total: {{VALUE:chapterTotal}}'], defaultOn: true },
    },
    ratingField(),
    ...bindCommunity(communityFields(true)),
    statusField(),
    bind(favoriteField(), { prop: 'favorite', read: 'boolean', write: 'raw' }),
    ...bindManual(manualFields()),
    {
        name: 'illustrator',
        keys: ['illustrator'],
        item: { prop: 'illustrator', read: 'textOrEmpty', write: 'trimmed' },
        template: { label: 'templateFieldIllustrator', lines: [], defaultOn: false },
    },
    integrationSourceField(true),
    bind({ ...urlField(), legacyKeys: ['source_url'] }, { prop: 'sourceUrl', read: 'text', write: 'trimmed' }),
    // No template: personal fields and structured lists the editor owns.
    // `rating` is deliberately not a legacy spelling of the user rating: for books it is
    // the provider rating the template writes, and clearing it lost that value.
    { name: 'userRating', keys: ['user-rating'], legacyKeys: ['userRating'] },
    { name: 'audiobook', keys: ['audiobook'], item: { prop: 'audiobook', read: 'boolean', write: 'orFalse' } },
    { name: 'started', keys: ['started'] },
    { name: 'finished', keys: ['finished'] },
    { name: 'relatedMedia', keys: ['related-media'], legacyKeys: ['related_media'] },
];

const MANGA_FIELDS: Spec[] = [
    typeField('manga'),
    nameField(),
    posterField(),
    // Manga was left out of the migration, so its template still writes `poster_b` and
    // `plot`. ReadingService's shared reader reads `poster-b` and `synopsis` for both
    // books and manga, so a manga import loses both until this is reconciled.
    posterHorizontalField('poster_b'),
    plotField('plot'),
    quotedListField('authors', 'templateFieldAuthors'),
    quotedListField('artists', 'templateFieldArtists'),
    quotedListField('genres', 'templateFieldGenres'),
    quotedListField('tags', 'templateFieldTags'),
    yearField(),
    {
        name: 'chapterCurrent',
        keys: ['chapter_current'],
        template: { label: 'templateFieldChapterCurrent', lines: ['chapter_current: {{VALUE:chapterCurrent}}'], defaultOn: true },
    },
    {
        name: 'chapterTotal',
        keys: ['chapter_total'],
        provider: { chapter_total: 'chapter_total' },
        template: { label: 'templateFieldChapterTotal', lines: ['chapter_total: {{VALUE:chapterTotal}}'], defaultOn: true },
    },
    {
        name: 'volumeCurrent',
        keys: ['volume_current'],
        template: { label: 'templateFieldVolumeCurrent', lines: ['volume_current: {{VALUE:volumeCurrent}}'], defaultOn: true },
    },
    {
        name: 'volumeTotal',
        keys: ['volume_total'],
        provider: { volume_total: 'volume_total' },
        template: { label: 'templateFieldVolumeTotal', lines: ['volume_total: {{VALUE:volumeTotal}}'], defaultOn: true },
    },
    {
        name: 'mangaParts',
        keys: ['manga_parts', 'active_part_id'],
        template: {
            label: 'templateFieldMangaParts',
            lines: ['active_part_id: "{{VALUE:activePartId}}"', 'manga_parts:', '{{VALUE:mangaPartsYaml}}'],
            defaultOn: true,
        },
    },
    ratingField(),
    ...communityFields(false),
    statusField(),
    favoriteField(),
    integrationSourceField(false),
    urlField(),
];

/**
 * Manga's template still writes several legacy keys, but ReadingService's shared reader
 * reads the kebab spellings of them for books and manga alike. A refresh must write what
 * the reader reads, so these provider aliases follow the reader rather than the template.
 * Reconciling manga's template with its reader removes this.
 */
const MANGA_REFRESH_KEYS: Record<string, string> = {
    poster_b: 'poster-b',
    plot: 'synopsis',
    communityRating: 'community-rating',
    communityVotes: 'community-votes',
    communityRatingProvider: 'community-rating-provider',
    integration_provider: 'integration-provider',
    integration_id: 'integration-id',
};

function withReaderProviderKeys(fields: Spec[], overrides: Record<string, string>): Spec[] {
    return fields.map((field) => {
        if (!field.provider) return field;
        const provider = Object.fromEntries(
            Object.entries(field.provider).map(([providerField, key]) => [providerField, overrides[providerField] ?? key])
        );
        return { ...field, provider };
    });
}

export const FIELD_REGISTRY: Record<MediaKind, readonly FieldSpec[]> = {
    games: GAME_FIELDS,
    anime: ANIME_FIELDS,
    movies: videoFields('movies'),
    tv: [...videoFields('tv'), ...TV_EXTRA_FIELDS],
    books: BOOK_FIELDS,
    manga: withReaderProviderKeys(MANGA_FIELDS, MANGA_REFRESH_KEYS),
};

/** Looks up one field of a kind by name; throws on a typo so a bad name fails loudly. */
export function getField(kind: MediaKind, name: string): FieldSpec {
    const field = FIELD_REGISTRY[kind].find((entry) => entry.name === name);
    if (!field) throw new Error(`Unknown ${kind} field: ${name}`);
    return field;
}

/** The kind's fields that appear as template checkboxes, in settings order. */
export function getTemplateFields(kind: MediaKind): FieldSpec[] {
    return FIELD_REGISTRY[kind].filter((field) => field.template);
}

/** Settings checkbox definitions; HowLongToBeat fields are listed separately. */
export function getSettingsTemplateFields(
    kind: MediaKind,
    options: { hltb?: boolean } = {}
): Array<{ key: string; label: TranslationKey }> {
    return getTemplateFields(kind)
        .filter((field) => Boolean(field.template?.hltb) === Boolean(options.hltb))
        .map((field) => ({ key: field.name, label: field.template!.label }));
}

/** Every field the generator accepts (the allowed set), without the HowLongToBeat ones. */
export function getAllowedTemplateFields(kind: MediaKind): string[] {
    return getTemplateFields(kind)
        .filter((field) => !field.template?.hltb && !field.template?.retired)
        .map((field) => field.name);
}

/** A fresh install's default field selection. */
export function getDefaultOnTemplateFields(kind: MediaKind): string[] {
    return getTemplateFields(kind)
        .filter((field) => field.template?.defaultOn)
        .map((field) => field.name);
}

/**
 * The simple template for a field selection. Lines come out in the order the fields are
 * listed; unknown, retired and manual fields contribute nothing.
 */
export function buildTemplateFromRegistry(kind: MediaKind, fields: readonly string[]): string {
    const lines: string[] = ['---'];
    const seen = new Set<string>();
    for (const rawName of fields) {
        const name = rawName === 'completionist' ? 'perfectionist' : rawName;
        if (seen.has(name)) continue;
        seen.add(name);
        const field = FIELD_REGISTRY[kind].find((entry) => entry.name === name);
        if (!field?.template || field.template.retired) continue;
        lines.push(...field.template.lines);
    }
    lines.push('---');
    return lines.join('\n');
}

/** Provider field name to the YAML key it fills, for one kind. */
export function getProviderAliases(kind: MediaKind): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const field of FIELD_REGISTRY[kind]) Object.assign(aliases, field.provider ?? {});
    return aliases;
}

/**
 * Every kind's provider aliases in one map, for callers that merge before the media kind
 * is known (note import). Where kinds disagree the migrated kinds win, since anime and
 * manga are the ones still on legacy keys.
 */
export function getCombinedProviderAliases(): Record<string, string> {
    const order: MediaKind[] = ['anime', 'manga', 'games', 'movies', 'tv', 'books'];
    return Object.assign({}, ...order.map((kind) => getProviderAliases(kind)));
}

/** The older spellings `key` replaced, for a field that owns it. */
export function getLegacyKeys(field: FieldSpec, key = field.keys[0]): string[] {
    const legacy = field.legacyKeys;
    if (!legacy) return [];
    if (Array.isArray(legacy)) return key === field.keys[0] ? legacy : [];
    return legacy[key] ?? [];
}
