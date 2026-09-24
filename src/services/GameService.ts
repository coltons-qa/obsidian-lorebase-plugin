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
import { collectFieldTags, collectSeriesNames, collectTags, getAllMarkdownFiles, isTruthy, mapInFrameBatches, normalizeCacheTags, readFrontmatterValue } from './media/serviceUtils';
import { upsertMarkdownSection } from './markdownSections';
import { keyOf, readBoundFields, writeBoundFields, writeNamedField } from '../fields/frontmatterIO';

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
        return collectSeriesNames(this.cache);
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

    private listOrNull(values: string[]): string[] | null {
        return values.length > 0 ? values : null;
    }

    /** Trimmed, whitespace-collapsed, de-duplicated case-insensitively; keeps display case. */
    private normalizeDisplayList(values: string[] | undefined): string[] {
        const normalized: string[] = [];
        const seen = new Set<string>();
        for (const value of values ?? []) {
            const displayValue = String(value ?? '').trim().replace(/\s+/g, ' ');
            const key = displayValue.toLocaleLowerCase();
            if (!displayValue || seen.has(key)) continue;
            seen.add(key);
            normalized.push(displayValue);
        }
        return normalized;
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

    public parseGameFromCache(file: TFile): GameItem | null {
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const metadata = cache?.frontmatter || {};

            const rawType = typeof metadata.type === 'string' ? metadata.type.trim().toLowerCase() : '';
            if (rawType && rawType !== 'game') {
                return null;
            }

            const bound = readBoundFields('games', metadata);
            const steamAppId = bound.steamAppId as string | null;

            // Get poster URLs (strict keys)
            const horizontalPoster = readFrontmatterValue(metadata, [keyOf('games', 'posterHorizontal')]);
            const rawPoster = typeof metadata.poster === 'string' ? metadata.poster : '';
            const rawHorizontalPoster = typeof horizontalPoster === 'string' ? horizontalPoster : '';
            const imageUrl = this.metadataService.getImageUrl(metadata.poster, metadata.cm_poster);
            const horizontalImageUrl = this.metadataService.getImageUrl(
                horizontalPoster,
                metadata.cm_poster
            );
            const tags = collectTags(metadata, normalizeCacheTags(cache?.tags));
            const genres = collectFieldTags(metadata, [keyOf('games', 'genres')]);
            const platforms = this.splitDisplayList(
                this.readFrontmatterText(metadata, [keyOf('games', 'platforms')]) ?? undefined
            );
            const started = this.readFrontmatterDateText(metadata, [keyOf('games', 'started')]);
            const finished = this.readFrontmatterDateText(metadata, [keyOf('games', 'finished')]);
            const dateCompleted = this.readCompletionTimestamp(metadata, finished);
            const releaseDate = this.readFrontmatterText(metadata, [keyOf('games', 'released')]);
            const publisher = this.readFrontmatterText(metadata, [keyOf('games', 'publishers')]) ?? '';
            const developer = this.readFrontmatterText(metadata, [keyOf('games', 'developers')]) ?? '';
            const title = this.readFrontmatterText(metadata, [keyOf('games', 'name')]) ?? file.basename ?? 'Unknown';
            const integrationProviderRaw = (this.readFrontmatterText(metadata, [keyOf('games', 'integrationSource', 0)]) ?? '').toLowerCase();
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
            const userRatingRaw = readFrontmatterValue(metadata, [keyOf('games', 'userRating')]);
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

            const game = {
                ...bound,
                type: 'game',
                filePath: file.path,
                displayName: title,
                nameLower: title.toLowerCase(),
                year,
                userRating,
                poster: rawPoster,
                imageUrl: imageUrl || rawPoster || DEFAULT_COVER,
                horizontalImageUrl: horizontalImageUrl || rawHorizontalPoster || null,
                hasCustomPoster: Boolean(metadata.cm_poster),
                status,
                dateCompleted,
                started,
                finished,
                releaseDate,
                publisher,
                developer,
                tags,
                genres,
                platforms,
                integrationProvider,
                integrationId: this.readFrontmatterText(metadata, [keyOf('games', 'integrationSource', 1)]) ?? steamAppId,
                dlc: this.parseDlcList(metadata[keyOf('games', 'dlc')]),
                relatedMedia: parseRelatedMedia(readFrontmatterValue(metadata, [keyOf('games', 'relatedMedia')])),
                rawFields: extractSimpleFrontmatter(metadata),
            } as GameItem;

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
            const series = game.series || noSeriesKey;
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

            if (game.series && game.series !== t('noSeries')) {
                seriesSet.add(game.series);
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

        // Simple fields (description, series, favorite, owned, count, repeatable, my
        // platform, url, Steam app id, community rating) come from the field registry.
        writeBoundFields('games', frontmatterUpdates, frontmatter, updates as Record<string, unknown>);
        const write = (name: string, value: unknown, key?: string): void =>
            writeNamedField('games', frontmatterUpdates, frontmatter, name, value, key);

        if ('userRating' in updates) write('userRating', updates.userRating);
        if ('status' in updates) {
            frontmatterUpdates.status = updates.status ?? 'planned';
            frontmatterUpdates.played = null;
            frontmatterUpdates.playing = null;
            frontmatterUpdates.dropped = null;
            frontmatterUpdates.sandbox = null;
            frontmatterUpdates.wishlist = null;
        }
        if ('year' in updates) write('year', updates.year);
        if ('displayName' in updates) write('name', updates.displayName?.trim() || null);
        if ('tags' in updates) write('tags', this.listOrNull(this.normalizeListForFrontmatter(updates.tags, true)));
        if ('genres' in updates) write('genres', this.listOrNull(this.normalizeListForFrontmatter(updates.genres)));
        if ('platforms' in updates) write('platforms', this.listOrNull(this.normalizeDisplayList(updates.platforms)));
        if ('releaseDate' in updates) write('released', (updates.releaseDate ?? '').trim() || null);
        if ('started' in updates) write('started', this.normalizeDateString(updates.started) || null);
        if ('finished' in updates) write('finished', this.normalizeDateString(updates.finished) || null);
        // Publishers and developers are stored as YAML lists; developers live under the
        // consolidated `author` key.
        if ('publisher' in updates) write('publishers', this.listOrNull(this.splitDisplayList(updates.publisher)));
        if ('developer' in updates) write('developers', this.listOrNull(this.splitDisplayList(updates.developer)));
        if ('integrationProvider' in updates) write('integrationSource', updates.integrationProvider, keyOf('games', 'integrationSource', 0));
        if ('integrationId' in updates) write('integrationSource', updates.integrationId, keyOf('games', 'integrationSource', 1));
        if ('dlc' in updates) write('dlc', this.serializeDlcList(updates.dlc));
        if ('relatedMedia' in updates) write('relatedMedia', serializeRelatedMedia(updates.relatedMedia));
        if ('dateCompleted' in updates) {
            write('finished', updates.dateCompleted && Number.isFinite(updates.dateCompleted)
                ? this.normalizeCompletionDateForFrontmatter(updates.dateCompleted)
                : null);
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
