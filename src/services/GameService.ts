/**
 * LOREBASE - Game Service (Optimized)
 * Handles game data loading, caching, filtering, and sorting
 * OPTIMIZED for performance with 10000+ items
 */

import { App, TFile, TFolder } from 'obsidian';
import { GameDlc, GameItem, GameStatus, FilterState, GameStats, SortField, SortOrder, UserRatingValue } from '../types';
import { MetadataService } from './MetadataService';
import { createRatingDistribution, DEFAULT_COVER, MAX_USER_RATING } from '../constants';
import { t } from '../localization';
import { filterAndSortMedia } from './media/filtering';
import { extractSimpleFrontmatter } from './media/libraryViewState';
import { getRandomItem, parseRelatedMedia, serializeRelatedMedia } from './media/parsers';
import { collectFieldTags, collectTags, getAllMarkdownFiles, isTruthy, mapInFrameBatches, normalizeCacheTags, readFrontmatterValue } from './media/serviceUtils';
import { upsertMarkdownSection } from './markdownSections';

export { extractMarkdownSection, upsertMarkdownSection } from './markdownSections';

const MY_NOTES_HEADING = 'My Notes';

// =============================================================================
// GAME SERVICE - OPTIMIZED
// =============================================================================

export class GameService {
    private app: App;
    private metadataService: MetadataService;
    private cache: GameItem[] = [];
    private cacheValid = false;
    private folderPath = 'Games';

    constructor(app: App, metadataService: MetadataService) {
        this.app = app;
        this.metadataService = metadataService;
    }

    setFolderPath(path: string): void {
        if (this.folderPath !== path) {
            this.folderPath = path;
            this.invalidateCache();
        }
    }

    invalidateCache(): void {
        this.cacheValid = false;
    }

    /**
     * Load all games - HIGHLY OPTIMIZED using metadataCache
     */
    async loadGames(): Promise<GameItem[]> {
        if (this.cacheValid && this.cache.length > 0) {
            return this.cache;
        }

        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!folder || !(folder instanceof TFolder)) {
            console.warn(`Games folder not found: ${this.folderPath}`);
            return [];
        }

        const files = getAllMarkdownFiles(folder);
        const games = await mapInFrameBatches(files, (file) => this.parseGameFromCache(file));

        this.cache = games;
        this.cacheValid = true;
        return games;
    }

    getSeriesList(): string[] {
        // Deliberately ignores cacheValid. Any metadata change in the vault invalidates
        // the cache without clearing it, so gating on the flag made this return nothing
        // for the rest of the session. Slightly stale names are fine for a suggestion list.
        if (this.cache.length === 0) return [];

        const seriesSet = new Set<string>();
        for (const game of this.cache) {
            const series = game?.gameSeries?.trim();
            if (series) seriesSet.add(series);
        }

        return Array.from(seriesSet.values()).sort((a, b) => a.localeCompare(b));
    }

    private parseCompletionDate(value: unknown): number | null {
        if (value === null || value === undefined) return null;

        if (value instanceof Date) {
            return value.getTime();
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value >= 1900 && value <= 2100) {
                return new Date(value, 0, 1).getTime();
            }
            if (value > 1e12) return value;
            if (value > 1e9) return value * 1000;
            return null;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            if (/^\d{4}$/.test(trimmed)) {
                return new Date(Number(trimmed), 0, 1).getTime();
            }
            const parsed = Date.parse(trimmed);
            return Number.isNaN(parsed) ? null : parsed;
        }

        return null;
    }

    private normalizeCompletionDateForFrontmatter(timestamp: number): string {
        const date = new Date(timestamp);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private readCompletionTimestamp(frontmatter: Record<string, unknown>, finished: string | null): number | null {
        return this.parseCompletionDate(finished)
            ?? this.parseCompletionDate(frontmatter.dateCompleted)
            ?? this.parseCompletionDate(frontmatter.completionDate);
    }

    private hasFrontmatterKey(frontmatter: Record<string, unknown> | null | undefined, key: string): boolean {
        if (!frontmatter) return false;
        return Boolean(Object.prototype.hasOwnProperty.call(frontmatter, key));
    }

    private readFrontmatterText(frontmatter: Record<string, unknown>, keys: string[]): string | null {
        for (const key of keys) {
            const value = frontmatter[key];
            if (value === undefined || value === null) continue;

            if (Array.isArray(value)) {
                const normalized = value
                    .map(item => String(item).trim())
                    .filter(Boolean)
                    .join(', ');
                if (normalized) return normalized;
                continue;
            }

            const normalized = String(value).trim();
            if (normalized) return normalized;
        }
        return null;
    }

    private readFrontmatterNumber(frontmatter: Record<string, unknown>, keys: string[]): number | null {
        for (const key of keys) {
            const value = frontmatter[key];
            if (value === undefined || value === null || value === '') continue;
            const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    }

    private readFrontmatterDateText(frontmatter: Record<string, unknown>, keys: string[]): string | null {
        const text = this.readFrontmatterText(frontmatter, keys);
        if (!text) return null;
        const normalized = this.normalizeDateString(text);
        return normalized || text;
    }

    private normalizeDateString(value: string | null | undefined): string {
        const trimmed = (value ?? '').trim();
        if (!trimmed) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return '';
        const date = new Date(parsed);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private normalizeListForFrontmatter(values: string[] | undefined, removeHashPrefix: boolean = false): string[] {
        if (!values?.length) return [];

        const normalized: string[] = [];
        const seen = new Set<string>();

        for (const value of values) {
            const raw = removeHashPrefix ? value.replace(/^#+/, '') : value;
            const cleaned = raw.trim().toLowerCase();
            if (!cleaned || seen.has(cleaned)) continue;
            seen.add(cleaned);
            normalized.push(cleaned);
        }

        return normalized;
    }

    private parseDlcList(value: unknown): GameDlc[] {
        if (!Array.isArray(value)) return [];
        const entries: GameDlc[] = [];
        const seen = new Set<string>();

        for (const item of value) {
            if (!item || typeof item !== 'object') continue;
            const record = item as Record<string, unknown>;
            const id = String(record.id ?? record.appid ?? '').trim();
            const title = String(record.title ?? record.name ?? '').trim();
            if (!id || !title || seen.has(id)) continue;
            seen.add(id);
            const owned = readFrontmatterValue(record, ['owned']);
            entries.push({
                id,
                provider: record.provider === 'igdb' ? 'igdb' : 'steam',
                title,
                imageUrl: this.readRecordText(record, ['image']),
                url: this.readRecordText(record, ['url']),
                userRating: this.parseUserRating(readFrontmatterValue(record, ['user-rating'])),
                owned: typeof owned === 'boolean' ? owned : undefined,
            });
        }

        return entries;
    }

    private serializeDlcList(values: GameDlc[] | undefined): Array<Record<string, unknown>> | null {
        if (!values?.length) return null;
        // `image` is the canonical key: it is what this method has always written, so
        // every DLC entry on disk uses it. The reader's `imageUrl` alias is kept for
        // provider payloads, which use the camelCase spelling.
        return values.map((item) => ({
            id: item.id,
            provider: item.provider,
            title: item.title,
            image: item.imageUrl || null,
            url: item.url || null,
            'user-rating': item.userRating ?? null,
            owned: item.owned ?? null,
        }));
    }

    private readRecordText(record: Record<string, unknown>, keys: string[]): string | null {
        for (const key of keys) {
            const value = record[key];
            if (value === null || value === undefined) continue;
            const text = String(value).trim();
            if (text) return text;
        }
        return null;
    }

    private parseUserRating(value: unknown): GameDlc['userRating'] {
        if (value === null || value === undefined || value === '') return null;
        const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
        return Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_USER_RATING
            ? parsed as GameDlc['userRating']
            : null;
    }

    private updateFrontmatterTextField(
        frontmatterUpdates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        singularKey: string,
        pluralKey: string,
        value: string | undefined
    ): void {
        const values = this.splitDisplayList(value);
        const prefersPlural = this.hasFrontmatterKey(frontmatter, pluralKey) && !this.hasFrontmatterKey(frontmatter, singularKey);

        if (values.length === 0) {
            frontmatterUpdates[singularKey] = null;
            frontmatterUpdates[pluralKey] = null;
            return;
        }

        if (values.length > 1 || prefersPlural) {
            frontmatterUpdates[pluralKey] = values;
            frontmatterUpdates[singularKey] = null;
            return;
        }

        frontmatterUpdates[singularKey] = values[0];
        if (this.hasFrontmatterKey(frontmatter, pluralKey)) frontmatterUpdates[pluralKey] = null;
    }

    private splitDisplayList(value: string | undefined): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const item of (value ?? '').split(/[,;\n]+/)) {
            const normalized = item.trim();
            const key = normalized.toLocaleLowerCase();
            if (!normalized || seen.has(key)) continue;
            seen.add(key);
            result.push(normalized);
        }
        return result;
    }

    private updateFrontmatterListField(
        frontmatterUpdates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        singularKey: string,
        pluralKey: string,
        values: string[] | undefined,
        removeHashPrefix: boolean = false
    ): void {
        const normalized = this.normalizeListForFrontmatter(values, removeHashPrefix);
        const hasSingular = this.hasFrontmatterKey(frontmatter, singularKey);
        const hasPlural = this.hasFrontmatterKey(frontmatter, pluralKey);

        if (hasSingular && !hasPlural) {
            frontmatterUpdates[singularKey] = normalized.length > 0 ? normalized : null;
            return;
        }

        frontmatterUpdates[pluralKey] = normalized.length > 0 ? normalized : null;
    }

    private updateFrontmatterDisplayListField(
        frontmatterUpdates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        singularKey: string,
        pluralKey: string,
        values: string[] | undefined
    ): void {
        const normalized: string[] = [];
        const seen = new Set<string>();
        for (const value of values ?? []) {
            const displayValue = String(value ?? '').trim().replace(/\s+/g, ' ');
            const key = displayValue.toLocaleLowerCase();
            if (!displayValue || seen.has(key)) continue;
            seen.add(key);
            normalized.push(displayValue);
        }

        const hasSingular = this.hasFrontmatterKey(frontmatter, singularKey);
        const hasPlural = this.hasFrontmatterKey(frontmatter, pluralKey);
        if (hasSingular && !hasPlural) {
            frontmatterUpdates[singularKey] = normalized.length > 0 ? normalized : null;
            return;
        }
        frontmatterUpdates[pluralKey] = normalized.length > 0 ? normalized : null;
    }

    private updateFrontmatterReleaseDate(
        frontmatterUpdates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        value: string | null | undefined
    ): void {
        const normalized = (value ?? '').trim();
        if (!normalized) {
            if (this.hasFrontmatterKey(frontmatter, 'released')) {
                frontmatterUpdates.released = null;
                return;
            }
            if (this.hasFrontmatterKey(frontmatter, 'release_date')) {
                frontmatterUpdates.release_date = null;
                return;
            }
            frontmatterUpdates.releaseDate = null;
            return;
        }

        if (this.hasFrontmatterKey(frontmatter, 'released')) {
            frontmatterUpdates.released = normalized;
            return;
        }
        if (this.hasFrontmatterKey(frontmatter, 'release_date')) {
            frontmatterUpdates.release_date = normalized;
            return;
        }
        frontmatterUpdates.releaseDate = normalized;
    }

    public parseGameFromCache(file: TFile): GameItem | null {
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const metadata = cache?.frontmatter || {};

            const rawType = typeof metadata.type === 'string' ? metadata.type.trim().toLowerCase() : '';
            if (rawType && rawType !== 'game') {
                return null;
            }

            // Get poster URLs (strict keys)
            const horizontalPoster = readFrontmatterValue(metadata, ['poster-b']);
            const rawPoster = typeof metadata.poster === 'string' ? metadata.poster : '';
            const rawHorizontalPoster = typeof horizontalPoster === 'string' ? horizontalPoster : '';
            const imageUrl = this.metadataService.getImageUrl(metadata.poster, metadata.cm_poster);
            const horizontalImageUrl = this.metadataService.getImageUrl(
                horizontalPoster,
                metadata.cm_poster
            );
            const tags = collectTags(metadata, normalizeCacheTags(cache?.tags));
            const genres = collectFieldTags(metadata, ['genres']);
            const platforms = this.splitDisplayList(
                this.readFrontmatterText(metadata, ['platforms']) ?? undefined
            );
            const started = this.readFrontmatterDateText(metadata, ['started']);
            const finished = this.readFrontmatterDateText(metadata, ['finished']);
            const dateCompleted = this.readCompletionTimestamp(metadata, finished);
            const releaseDate = this.readFrontmatterText(metadata, ['released']);
            const publisher = this.readFrontmatterText(metadata, ['publishers']) ?? '';
            const developer = this.readFrontmatterText(metadata, ['author']) ?? '';
            const title = this.readFrontmatterText(metadata, ['title']) ?? file.basename ?? 'Unknown';
            const sourceUrl = this.readFrontmatterText(metadata, ['url']);
            const steamAppId = this.readFrontmatterText(metadata, ['steam-app-id']);
            const integrationProviderRaw = (this.readFrontmatterText(metadata, ['integration-provider']) ?? '').toLowerCase();
            const integrationProvider = integrationProviderRaw === 'rawg' || integrationProviderRaw === 'steam' || integrationProviderRaw === 'igdb'
                ? integrationProviderRaw
                : steamAppId
                    ? 'steam'
                : null;

            // Determine status (prefer status field, fallback to legacy booleans)
            let status: GameStatus = 'planned';
            const statusRaw = typeof metadata.status === 'string' ? metadata.status.toLowerCase() : '';
            const statusNormalized = statusRaw.replace(/[-\s]+/g, '_');
            // @deprecated Legacy boolean status fallback kept for old notes.
            if (statusNormalized === 'played') {
                status = 'completed';
            } else if (statusNormalized === 'not_started' || statusNormalized === 'wishlist') {
                // Legacy migration: not_started and wishlist both map to planned
                status = 'planned';
            } else if (['planned', 'completed', 'playing', 'dropped', 'sandbox', 'paused'].includes(statusNormalized)) {
                status = statusNormalized as GameStatus;
            } else if (isTruthy(metadata.played)) {
                status = 'completed';
            } else if (isTruthy(metadata.playing)) {
                status = 'playing';
            } else if (isTruthy(metadata.dropped)) {
                status = 'dropped';
            } else if (isTruthy(metadata.sandbox)) {
                status = 'sandbox';
            } else if (isTruthy(metadata.wishlist)) {
                status = 'planned';
            }

            // Parse rating safely
            let userRating = null;
            const userRatingRaw = readFrontmatterValue(metadata, ['user-rating']);
            if (userRatingRaw !== undefined && userRatingRaw !== null) {
                const rating = typeof userRatingRaw === 'string'
                    ? parseInt(userRatingRaw, 10)
                    : Number(userRatingRaw);
                if (!isNaN(rating) && rating >= 1 && rating <= MAX_USER_RATING) {
                    userRating = rating as UserRatingValue;
                }
            }

            // Parse year safely
            let year: number | null = null;
            if (metadata.year !== undefined && metadata.year !== null) {
                const parsed = typeof metadata.year === 'number'
                    ? metadata.year
                    : parseInt(String(metadata.year), 10);
                if (!isNaN(parsed)) year = parsed;
            }

            const game: GameItem = {
                type: 'game',
                filePath: file.path,
                displayName: title,
                nameLower: title.toLowerCase(),
                year,
                description: this.readFrontmatterText(metadata, ['synopsis']) ?? '',
                userRating,
                favorite: isTruthy(metadata.favorite),
                poster: rawPoster,
                imageUrl: imageUrl || rawPoster || DEFAULT_COVER,
                horizontalImageUrl: horizontalImageUrl || rawHorizontalPoster || null,
                hasCustomPoster: Boolean(metadata.cm_poster),
                status,
                gameSeries: this.readFrontmatterText(metadata, ['series']) ?? '',
                dateCompleted,
                started,
                finished,
                releaseDate,
                publisher,
                developer,
                tags,
                genres,
                platforms,
                sourceUrl,
                integrationProvider,
                integrationId: this.readFrontmatterText(metadata, ['integration-id']) ?? steamAppId,
                steamAppId,
                owned: this.readFrontmatterText(metadata, ['owned']),
                count: this.readFrontmatterNumber(metadata, ['count']),
                repeatable: isTruthy(metadata.repeatable),
                myPlatform: this.readFrontmatterText(metadata, ['my-platform']) ?? '',
                dlc: this.parseDlcList(metadata.dlc),
                relatedMedia: parseRelatedMedia(readFrontmatterValue(metadata, ['related-media'])),
                rawFields: extractSimpleFrontmatter(metadata),
                communityRating: this.readFrontmatterNumber(metadata, ['community-rating']),
                communityVotes: this.readFrontmatterNumber(metadata, ['community-votes']),
                communityRatingProvider: this.readFrontmatterText(metadata, ['community-rating-provider']),
            };

            return game;
        } catch (e) {
            console.error(`Error parsing game file ${file.path}:`, e);
            return null;
        }
    }

    /**
     * Filter and sort games - OPTIMIZED with safe comparisons
     */
    filterAndSort(
        games: GameItem[],
        filter: FilterState,
        sortField: SortField,
        sortOrder: SortOrder
    ): GameItem[] {
        return filterAndSortMedia({
            items: games,
            filter,
            sortField,
            sortOrder,
            getCompletedDate: (game) => game.dateCompleted,
            isVisible: (game) => (filter.customOnly ? game.hasCustomPoster : true),
        });
    }

    /**
     * Group games by series - SIMPLIFIED
     */
    groupBySeries(games: GameItem[], sortOrder: SortOrder): Map<string, GameItem[]> {
        const grouped = new Map<string, GameItem[]>();
        const noSeriesKey = t('noSeries');

        for (const game of games) {
            if (!game) continue;
            const series = game.gameSeries || noSeriesKey;
            if (!grouped.has(series)) {
                grouped.set(series, []);
            }
            grouped.get(series)!.push(game);
        }

        // Sort within each series by release year for chronological series order.
        for (const seriesGames of grouped.values()) {
            seriesGames.sort((a, b) => {
                const aYear = a?.year ?? 0;
                const bYear = b?.year ?? 0;
                return sortOrder === 'asc' ? aYear - bYear : bYear - aYear;
            });
        }

        // Sort series keys
        const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
            if (a === noSeriesKey) return 1;
            if (b === noSeriesKey) return -1;
            return sortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
        });

        const sortedMap = new Map<string, GameItem[]>();
        for (const key of sortedKeys) {
            sortedMap.set(key, grouped.get(key)!);
        }

        return sortedMap;
    }

    calculateStats(games: GameItem[]): GameStats {
        const stats: GameStats = {
            total: games.length,
            completed: 0, playing: 0, dropped: 0, sandbox: 0, planned: 0, paused: 0,
            favorite: 0, withRating: 0, avgRating: 0,
            customPosters: 0, seriesCount: 0,
            ratingDistribution: createRatingDistribution(),
            statusPercentages: {},
        };

        let ratingSum = 0;
        const seriesSet = new Set<string>();

        for (const game of games) {
            if (!game) continue;

            switch (game.status) {
                case 'completed': stats.completed++; break;
                case 'playing': stats.playing++; break;
                case 'dropped': stats.dropped++; break;
                case 'sandbox': stats.sandbox++; break;
                case 'planned': stats.planned++; break;
                case 'paused': stats.paused++; break;
            }

            if (game.favorite) stats.favorite++;
            if (game.hasCustomPoster) stats.customPosters++;

            if (game.userRating) {
                stats.withRating++;
                ratingSum += game.userRating;
                stats.ratingDistribution[game.userRating] = (stats.ratingDistribution[game.userRating] || 0) + 1;
            }

            if (game.gameSeries && game.gameSeries !== t('noSeries')) {
                seriesSet.add(game.gameSeries);
            }
        }

        stats.avgRating = stats.withRating > 0 ? Math.round((ratingSum / stats.withRating) * 10) / 10 : 0;
        stats.seriesCount = seriesSet.size;

        if (stats.total > 0) {
                stats.statusPercentages = {
                    completed: Math.round((stats.completed / stats.total) * 1000) / 10,
                    playing: Math.round((stats.playing / stats.total) * 1000) / 10,
                    dropped: Math.round((stats.dropped / stats.total) * 1000) / 10,
                    sandbox: Math.round((stats.sandbox / stats.total) * 1000) / 10,
                    planned: Math.round((stats.planned / stats.total) * 1000) / 10,
                    paused: Math.round((stats.paused / stats.total) * 1000) / 10,
                };
            }

        return stats;
    }

    async updateGame(game: GameItem, updates: Partial<GameItem>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(game.filePath);
        if (!file || !(file instanceof TFile)) {
            console.error('Game file not found:', game.filePath);
            return;
        }

        const frontmatterUpdates: Record<string, unknown> = {};
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

        if ('userRating' in updates) {
            frontmatterUpdates['user-rating'] = updates.userRating;
            if (this.hasFrontmatterKey(frontmatter, 'userRating')) frontmatterUpdates.userRating = null;
        }
        if ('favorite' in updates) frontmatterUpdates.favorite = updates.favorite;
        if ('status' in updates) {
            frontmatterUpdates.status = updates.status ?? 'planned';
            frontmatterUpdates.played = null;
            frontmatterUpdates.playing = null;
            frontmatterUpdates.dropped = null;
            frontmatterUpdates.sandbox = null;
            frontmatterUpdates.wishlist = null;
        }
        if ('year' in updates) frontmatterUpdates.year = updates.year;
        if ('displayName' in updates) {
            const title = updates.displayName?.trim() ?? '';
            frontmatterUpdates.title = title || null;
            if (this.hasFrontmatterKey(frontmatter, 'name')) frontmatterUpdates.name = null;
        }
        if ('description' in updates) {
            frontmatterUpdates.synopsis = updates.description;
            if (this.hasFrontmatterKey(frontmatter, 'plot')) frontmatterUpdates.plot = null;
        }
        if ('gameSeries' in updates) {
            frontmatterUpdates.series = updates.gameSeries || '';
            if (this.hasFrontmatterKey(frontmatter, 'gameSeries')) frontmatterUpdates.gameSeries = null;
        }
        if ('tags' in updates) this.updateFrontmatterListField(frontmatterUpdates, frontmatter, 'tag', 'tags', updates.tags, true);
        if ('genres' in updates) this.updateFrontmatterListField(frontmatterUpdates, frontmatter, 'genre', 'genres', updates.genres);
        if ('platforms' in updates) this.updateFrontmatterDisplayListField(frontmatterUpdates, frontmatter, 'platform', 'platforms', updates.platforms);
        if ('releaseDate' in updates) this.updateFrontmatterReleaseDate(frontmatterUpdates, frontmatter, updates.releaseDate);
        if ('started' in updates) frontmatterUpdates.started = this.normalizeDateString(updates.started) || null;
        if ('finished' in updates) {
            const normalizedFinished = this.normalizeDateString(updates.finished);
            frontmatterUpdates.finished = normalizedFinished || null;
            if (this.hasFrontmatterKey(frontmatter, 'dateCompleted')) frontmatterUpdates.dateCompleted = null;
            if (this.hasFrontmatterKey(frontmatter, 'completionDate')) frontmatterUpdates.completionDate = null;
        }
        if ('publisher' in updates) this.updateFrontmatterTextField(frontmatterUpdates, frontmatter, 'publisher', 'publishers', updates.publisher);
        if ('developer' in updates) {
            // developer/developers consolidated onto a single `author` key, so the
            // singular/plural helper does not apply: given one key for both roles it
            // writes the value and then nulls it. Keeps the list shape `developers` had.
            const authors = this.splitDisplayList(updates.developer);
            frontmatterUpdates.author = authors.length > 0 ? authors : null;
            if (this.hasFrontmatterKey(frontmatter, 'developer')) frontmatterUpdates.developer = null;
            if (this.hasFrontmatterKey(frontmatter, 'developers')) frontmatterUpdates.developers = null;
        }
        if ('sourceUrl' in updates) frontmatterUpdates.url = updates.sourceUrl || null;
        if ('integrationProvider' in updates) {
            frontmatterUpdates['integration-provider'] = updates.integrationProvider;
            if (this.hasFrontmatterKey(frontmatter, 'integration_provider')) frontmatterUpdates.integration_provider = null;
        }
        if ('integrationId' in updates) {
            frontmatterUpdates['integration-id'] = updates.integrationId;
            if (this.hasFrontmatterKey(frontmatter, 'integration_id')) frontmatterUpdates.integration_id = null;
        }
        if ('steamAppId' in updates) {
            frontmatterUpdates['steam-app-id'] = updates.steamAppId;
            if (this.hasFrontmatterKey(frontmatter, 'steamAppId')) frontmatterUpdates.steamAppId = null;
        }
        if ('owned' in updates) frontmatterUpdates.owned = updates.owned || null;
        if ('count' in updates) frontmatterUpdates.count = updates.count ?? null;
        if ('repeatable' in updates) frontmatterUpdates.repeatable = updates.repeatable ?? false;
        if ('myPlatform' in updates) frontmatterUpdates['my-platform'] = updates.myPlatform || null;
        if ('dlc' in updates) frontmatterUpdates.dlc = this.serializeDlcList(updates.dlc);
        if ('relatedMedia' in updates) {
            frontmatterUpdates['related-media'] = serializeRelatedMedia(updates.relatedMedia);
            if (this.hasFrontmatterKey(frontmatter, 'related_media')) frontmatterUpdates.related_media = null;
        }
        if ('communityRating' in updates) {
            frontmatterUpdates['community-rating'] = updates.communityRating;
            if (this.hasFrontmatterKey(frontmatter, 'communityRating')) frontmatterUpdates.communityRating = null;
        }
        if ('communityVotes' in updates) {
            frontmatterUpdates['community-votes'] = updates.communityVotes;
            if (this.hasFrontmatterKey(frontmatter, 'communityVotes')) frontmatterUpdates.communityVotes = null;
        }
        if ('communityRatingProvider' in updates) {
            frontmatterUpdates['community-rating-provider'] = updates.communityRatingProvider;
            if (this.hasFrontmatterKey(frontmatter, 'communityRatingProvider')) frontmatterUpdates.communityRatingProvider = null;
        }
        if ('dateCompleted' in updates) {
            frontmatterUpdates.finished = updates.dateCompleted && Number.isFinite(updates.dateCompleted)
                ? this.normalizeCompletionDateForFrontmatter(updates.dateCompleted)
                : null;
            if (this.hasFrontmatterKey(frontmatter, 'dateCompleted')) frontmatterUpdates.dateCompleted = null;
            if (this.hasFrontmatterKey(frontmatter, 'completionDate')) frontmatterUpdates.completionDate = null;
        }
        // Note: hasCustomPoster is read-only from cm_poster value, don't write boolean to it

        await this.metadataService.updateMetadata(file, frontmatterUpdates);
        if ('myNotes' in updates) {
            await this.updateMyNotesSection(file, updates.myNotes ?? '');
        }

        // No manual refresh here! We rely on metadataCache event in the View.
    }

    private async updateMyNotesSection(file: TFile, value: string): Promise<void> {
        const content = await this.app.vault.read(file);
        const next = upsertMarkdownSection(content, MY_NOTES_HEADING, value);
        if (next !== content) {
            await this.app.vault.modify(file, next);
        }
    }

    async deleteGame(game: GameItem): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(game.filePath);
        if (!file || !(file instanceof TFile)) return false;

        try {
            await this.app.fileManager.trashFile(file);
            this.cache = this.cache.filter(g => g.filePath !== game.filePath);
            return true;
        } catch (e) {
            console.error('Error deleting game:', e);
            return false;
        }
    }

    getRandomGame(games: GameItem[]): GameItem | null {
        return getRandomItem(games);
    }
}
