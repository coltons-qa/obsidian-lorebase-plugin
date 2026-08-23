import { App, TFile, TFolder } from 'obsidian';
import { FilterState, MangaItem, MangaPart, ReadingItem, ReadingStatus, ReadingStats, SortField, SortOrder } from '../types';
import { createRatingDistribution, DEFAULT_COVER } from '../constants';
import { MetadataService } from './MetadataService';
import { filterAndSortMedia } from './media/filtering';
import { extractSimpleFrontmatter } from './media/libraryViewState';
import { getRandomItem, parseNumber, parseRelatedMedia, parseUserRating, parseYear, serializeRelatedMedia } from './media/parsers';
import { collectFieldTags, collectTags, getAllMarkdownFiles, isTruthy, mapInFrameBatches, readFrontmatterValue } from './media/serviceUtils';
import { upsertMarkdownSection } from './markdownSections';

export type ReadingMediaType = 'book' | 'manga';

export class ReadingService {
    private app: App;
    private metadataService: MetadataService;
    private cache: ReadingItem[] = [];
    private cacheValid = false;
    private folderPath: string;
    private mediaType: ReadingMediaType;

    constructor(app: App, mediaType: ReadingMediaType, folderPath: string, metadataService: MetadataService) {
        this.app = app;
        this.mediaType = mediaType;
        this.folderPath = folderPath;
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

    async loadItems(): Promise<ReadingItem[]> {
        if (this.cacheValid) return this.cache;

        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!folder || !(folder instanceof TFolder)) {
            console.warn(`${this.mediaType} folder not found: ${this.folderPath}`);
            return [];
        }

        this.cache = await mapInFrameBatches(
            getAllMarkdownFiles(folder),
            (file) => this.parseFromCache(file)
        );
        this.cacheValid = true;
        return this.cache;
    }

    parseFromCache(file: TFile): ReadingItem | null {
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const rawMetadata: unknown = cache?.frontmatter;
            const metadata = isRecord(rawMetadata) ? rawMetadata : {};
            const rawType = typeof metadata.type === 'string' ? metadata.type.trim().toLowerCase() : '';
            if (rawType && rawType !== this.mediaType) return null;

            const title = this.readText(metadata, ['title', 'name']) || file.basename?.trim() || 'Untitled';
            const description = this.readText(metadata, ['synopsis', 'plot', 'summary', 'description']) || '';
            const poster = this.readText(metadata, ['poster', 'image']) || null;
            const horizontal = this.readText(metadata, ['poster-b', 'poster_b', 'image_b', 'horizontal_poster']) || poster;
            const verticalImageUrl = this.metadataService.getImageUrl(metadata.poster ?? metadata.image, metadata.cm_poster);
            const horizontalImageUrl = this.metadataService.getImageUrl(readFrontmatterValue(metadata, ['poster-b', 'poster_b', 'image_b', 'horizontal_poster']), metadata.cm_poster);
            const status = this.getStatus(this.readText(metadata, ['status']) || '') ?? 'planned';
            const genres = collectFieldTags(metadata, ['genres', 'genre', 'subjects', 'subject']);
            const base = {
                filePath: file.path,
                displayName: title,
                nameLower: title.toLowerCase(),
                year: parseYear(metadata.year ?? metadata.first_publish_year),
                description,
                summary: description,
                userRating: parseUserRating(readFrontmatterValue(metadata, ['user-rating', 'userRating', 'rating_user', 'rating'])),
                favorite: isTruthy(metadata.favorite),
                poster,
                imageUrl: verticalImageUrl || poster || DEFAULT_COVER,
                horizontalImageUrl: horizontalImageUrl || horizontal || verticalImageUrl || poster || null,
                hasCustomPoster: Boolean(metadata.cm_poster || poster),
                status,
                genres,
                tags: collectTags(metadata, cache?.tags),
                dateAdded: file.stat?.ctime ?? file.stat?.mtime ?? Date.now(),
                lastModified: file.stat?.mtime ?? file.stat?.ctime ?? Date.now(),
                sourceUrl: this.readText(metadata, ['url', 'source_url']) || null,
                started: this.readDateText(metadata, ['started', 'dateStarted', 'start_date']),
                finished: this.readDateText(metadata, ['finished', 'dateFinished', 'finish_date', 'dateRead', 'readDate', 'completedDate']),
                integrationProvider: this.normalizeProvider(this.readText(metadata, ['integration-provider', 'integration_provider'])),
                integrationId: this.readText(metadata, ['integration-id', 'integration_id']) || null,
                relatedMedia: parseRelatedMedia(readFrontmatterValue(metadata, ['related-media', 'related_media'])),
                communityRating: parseNumber(readFrontmatterValue(metadata, ['community-rating', 'communityRating', 'community_rating'])),
                communityVotes: parseNumber(readFrontmatterValue(metadata, ['community-votes', 'communityVotes', 'community_votes'])),
                communityRatingProvider: this.readText(metadata, ['community-rating-provider', 'communityRatingProvider', 'community_rating_provider']) || null,
                rawFields: extractSimpleFrontmatter(metadata),
            };

            if (this.mediaType === 'book') {
                return {
                    ...base,
                    type: 'book',
                    authors: this.toStringArray(readFrontmatterValue(metadata, ['author', 'authors', 'author_name'])),
                    publisher: this.readText(metadata, ['publisher', 'publishers']) || '',
                    releaseDate: this.readDateText(metadata, ['released', 'release_date', 'publishedDate', 'publish_date']),
                    pageCurrent: parseNumber(readFrontmatterValue(metadata, ['page-current', 'page_current', 'pageCurrent'])),
                    pageTotal: parseNumber(readFrontmatterValue(metadata, ['page-total', 'page_total', 'pageTotal', 'pages', 'pageCount', 'number_of_pages'])),
                    chapterCurrent: parseNumber(readFrontmatterValue(metadata, ['chapter-current', 'chapter_current', 'chapterCurrent'])),
                    chapterTotal: parseNumber(readFrontmatterValue(metadata, ['chapter-total', 'chapter_total', 'chapterTotal', 'chapters'])),
                    integrationProvider: base.integrationProvider === 'hardcover' || base.integrationProvider === 'googlebooks'
                        ? base.integrationProvider
                        : null,
                };
            }

            const chapterCurrent = parseNumber(metadata.chapter_current ?? metadata.chapterCurrent);
            const chapterTotal = parseNumber(metadata.chapter_total ?? metadata.chapterTotal ?? metadata.chapters);
            const volumeCurrent = parseNumber(metadata.volume_current ?? metadata.volumeCurrent);
            const volumeTotal = parseNumber(metadata.volume_total ?? metadata.volumeTotal ?? metadata.volumes);
            const parts = this.normalizeMangaParts(metadata, {
                chapterCurrent,
                chapterTotal,
                volumeCurrent,
                volumeTotal,
                status,
            });
            const activePartId = this.normalizeActivePartId(parts, this.readText(metadata, ['active_part_id']));
            const activePart = this.getActivePart(parts, activePartId);

            return {
                ...base,
                type: 'manga',
                authors: this.toStringArray(metadata.authors ?? metadata.author),
                artists: this.toStringArray(metadata.artists ?? metadata.artist),
                chapterCurrent: activePart?.chapterCurrent ?? chapterCurrent,
                chapterTotal: activePart?.chapterTotal ?? chapterTotal,
                volumeCurrent: activePart?.volumeNumber ?? volumeCurrent,
                volumeTotal: volumeTotal ?? (parts.length ? parts.length : null),
                parts,
                activePartId,
                integrationProvider: base.integrationProvider === 'anilist'
                    || base.integrationProvider === 'jikan'
                    || base.integrationProvider === 'shikimori'
                    || base.integrationProvider === 'mangaupdates'
                    || base.integrationProvider === 'mangadex'
                    ? base.integrationProvider
                    : null,
            };
        } catch (error) {
            console.error(`Error parsing ${this.mediaType}:`, error);
            return null;
        }
    }

    filterAndSort(
        items: ReadingItem[],
        filter: FilterState,
        sortField: SortField,
        sortOrder: SortOrder
    ): ReadingItem[] {
        return filterAndSortMedia({
            items,
            filter,
            sortField,
            sortOrder,
            getCompletedDate: (item) => this.parseDateString(item.finished),
        });
    }

    getRandomItem(items: ReadingItem[]): ReadingItem | null {
        return getRandomItem(items);
    }

    calculateStats(items: ReadingItem[]): ReadingStats {
        const stats: ReadingStats = {
            total: items.length,
            planned: 0,
            watching: 0,
            completed: 0,
            dropped: 0,
            paused: 0,
            favorite: 0,
            withRating: 0,
            avgRating: 0,
            ratingDistribution: createRatingDistribution(),
            statusPercentages: {},
        };

        let ratingSum = 0;
        for (const item of items) {
            stats[item.status]++;
            if (item.favorite) stats.favorite++;
            if (item.userRating) {
                stats.withRating++;
                ratingSum += item.userRating;
                stats.ratingDistribution[item.userRating] = (stats.ratingDistribution[item.userRating] || 0) + 1;
            }
        }
        stats.avgRating = stats.withRating > 0 ? Math.round((ratingSum / stats.withRating) * 10) / 10 : 0;
        for (const status of ['planned', 'watching', 'completed', 'dropped', 'paused'] as const) {
            stats.statusPercentages[status] = stats.total > 0 ? Math.round((stats[status] / stats.total) * 1000) / 10 : 0;
        }
        return stats;
    }

    async updateItem(item: ReadingItem, updates: Partial<ReadingItem> & Record<string, unknown>): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (!(file instanceof TFile)) return;

        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const frontmatterUpdates: Record<string, unknown> = {};

        frontmatterUpdates.type = item.type;
        if ('displayName' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['title', 'name'], updates.displayName);
        if ('title' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['title', 'name'], String(updates.title ?? ''));
        if ('year' in updates) frontmatterUpdates.year = updates.year;
        if ('description' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['synopsis', 'plot', 'summary', 'description'], updates.description);
        if ('summary' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['synopsis', 'plot', 'summary', 'description'], updates.summary);
        if ('poster' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['poster', 'image'], updates.poster);
        if ('imageUrl' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['poster', 'image'], updates.imageUrl === DEFAULT_COVER ? '' : updates.imageUrl);
        if ('horizontalImageUrl' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['poster-b', 'poster_b', 'image_b', 'horizontal_poster'], updates.horizontalImageUrl);
        if ('genres' in updates) this.updateListField(frontmatterUpdates, frontmatter, ['genres', 'genre'], updates.genres);
        if ('tags' in updates) this.updateListField(frontmatterUpdates, frontmatter, ['tags', 'tag'], updates.tags, true);
        if ('status' in updates) frontmatterUpdates.status = updates.status;
        if ('userRating' in updates) {
            frontmatterUpdates['user-rating'] = updates.userRating ?? null;
            // `rating` was the old target and doubles as the provider rating elsewhere,
            // so only clear it when this note actually carries it.
            if (this.hasKey(frontmatter, 'rating')) frontmatterUpdates.rating = null;
        }
        if ('favorite' in updates) frontmatterUpdates.favorite = updates.favorite;
        if ('sourceUrl' in updates) this.updateTextField(frontmatterUpdates, frontmatter, ['url', 'source_url'], updates.sourceUrl);
        if ('started' in updates) frontmatterUpdates.started = this.normalizeDateString(String(updates.started ?? '')) || null;
        if ('finished' in updates) frontmatterUpdates.finished = this.normalizeDateString(String(updates.finished ?? '')) || null;
        if ('integrationProvider' in updates) {
            frontmatterUpdates['integration-provider'] = updates.integrationProvider;
            if (this.hasKey(frontmatter, 'integration_provider')) frontmatterUpdates.integration_provider = null;
        }
        if ('integrationId' in updates) {
            frontmatterUpdates['integration-id'] = updates.integrationId;
            if (this.hasKey(frontmatter, 'integration_id')) frontmatterUpdates.integration_id = null;
        }
        if ('relatedMedia' in updates) {
            frontmatterUpdates['related-media'] = serializeRelatedMedia(updates.relatedMedia);
            if (this.hasKey(frontmatter, 'related_media')) frontmatterUpdates.related_media = null;
        }
        if ('communityRating' in updates) {
            frontmatterUpdates['community-rating'] = updates.communityRating;
            if (this.hasKey(frontmatter, 'communityRating')) frontmatterUpdates.communityRating = null;
        }
        if ('communityVotes' in updates) {
            frontmatterUpdates['community-votes'] = updates.communityVotes;
            if (this.hasKey(frontmatter, 'communityVotes')) frontmatterUpdates.communityVotes = null;
        }
        if ('communityRatingProvider' in updates) {
            frontmatterUpdates['community-rating-provider'] = updates.communityRatingProvider;
            if (this.hasKey(frontmatter, 'communityRatingProvider')) frontmatterUpdates.communityRatingProvider = null;
        }

        if (item.type === 'book') {
            if ('authors' in updates) {
                // `author` is the single canonical key now, so the singular/plural helper
                // does not apply: given one key for both roles it writes then nulls it.
                const authors = this.toDisplayList(updates.authors);
                frontmatterUpdates.author = authors.length > 0 ? authors : null;
                if (this.hasKey(frontmatter, 'authors')) frontmatterUpdates.authors = null;
            }
            if ('publisher' in updates) this.updateDisplayListField(
                frontmatterUpdates,
                frontmatter,
                'publisher',
                'publishers',
                updates.publisher
            );
            if ('releaseDate' in updates) this.updateTextField(
                frontmatterUpdates,
                frontmatter,
                ['released', 'release_date', 'publishedDate'],
                this.normalizeDateString(String(updates.releaseDate ?? ''))
            );
            const pageTotal = 'pageTotal' in updates ? this.normalizeProgressValue(updates.pageTotal) : item.pageTotal;
            const pageCurrent = 'pageCurrent' in updates ? this.normalizeProgressValue(updates.pageCurrent, pageTotal) : item.pageCurrent;
            const chapterTotal = 'chapterTotal' in updates ? this.normalizeProgressValue(updates.chapterTotal) : item.chapterTotal;
            const chapterCurrent = 'chapterCurrent' in updates ? this.normalizeProgressValue(updates.chapterCurrent, chapterTotal) : item.chapterCurrent;
            if ('pageCurrent' in updates) {
                frontmatterUpdates['page-current'] = pageCurrent;
                if (this.hasKey(frontmatter, 'page_current')) frontmatterUpdates.page_current = null;
            }
            if ('pageTotal' in updates) {
                frontmatterUpdates['page-total'] = pageTotal;
                if (this.hasKey(frontmatter, 'page_total')) frontmatterUpdates.page_total = null;
            }
            if ('chapterCurrent' in updates) {
                frontmatterUpdates['chapter-current'] = chapterCurrent;
                if (this.hasKey(frontmatter, 'chapter_current')) frontmatterUpdates.chapter_current = null;
            }
            if ('chapterTotal' in updates) {
                frontmatterUpdates['chapter-total'] = chapterTotal;
                if (this.hasKey(frontmatter, 'chapter_total')) frontmatterUpdates.chapter_total = null;
            }
            const pagesDone = (pageTotal ?? 0) > 0 && (pageCurrent ?? 0) >= (pageTotal ?? 0);
            const chaptersDone = (chapterTotal ?? 0) > 0 && (chapterCurrent ?? 0) >= (chapterTotal ?? 0);
            if (pagesDone || chaptersDone) {
                frontmatterUpdates.status = 'completed';
            }
        } else {
            if ('authors' in updates) this.updateDisplayListField(
                frontmatterUpdates,
                frontmatter,
                'author',
                'authors',
                updates.authors
            );
            if ('artists' in updates) this.updateDisplayListField(
                frontmatterUpdates,
                frontmatter,
                'artist',
                'artists',
                updates.artists
            );
            let parts = this.cloneParts(Array.isArray(updates.parts) ? updates.parts as MangaPart[] : item.parts ?? []);
            let activePartId = updates.activePartId !== undefined ? String(updates.activePartId || '') || null : item.activePartId ?? null;
            const chapterTotal = 'chapterTotal' in updates ? this.normalizeProgressValue(updates.chapterTotal) : item.chapterTotal;
            const chapterCurrent = 'chapterCurrent' in updates ? this.normalizeProgressValue(updates.chapterCurrent, chapterTotal) : item.chapterCurrent;

            if (parts.length) {
                if ('volumeCurrent' in updates) {
                    const targetVolume = parseNumber(updates.volumeCurrent);
                    const volumePart = parts.find((part) => part.volumeNumber === targetVolume);
                    if (volumePart) activePartId = volumePart.id;
                }
                const activeIndex = parts.findIndex((part) => part.id === activePartId);
                const normalizedIndex = activeIndex >= 0 ? activeIndex : 0;
                const active = parts[normalizedIndex];
                activePartId = active?.id ?? null;
                if (active && 'chapterCurrent' in updates) active.chapterCurrent = chapterCurrent;
                if (active && 'chapterTotal' in updates) active.chapterTotal = chapterTotal;
                if (active && (active.chapterTotal ?? 0) > 0 && (active.chapterCurrent ?? 0) >= (active.chapterTotal ?? 0)) {
                    active.status = 'completed';
                }
            }

            if (parts.length && this.areAllMangaPartsCompleted(parts)) {
                frontmatterUpdates.status = 'completed';
            }
            if ('parts' in updates || 'chapterCurrent' in updates || 'chapterTotal' in updates || 'volumeCurrent' in updates) {
                frontmatterUpdates.manga_parts = this.serializeMangaParts(parts);
                frontmatterUpdates.active_part_id = activePartId ?? null;
            }
            if ('chapterCurrent' in updates) frontmatterUpdates.chapter_current = chapterCurrent;
            if ('chapterTotal' in updates) frontmatterUpdates.chapter_total = chapterTotal;
            if ('volumeCurrent' in updates) frontmatterUpdates.volume_current = this.normalizeProgressValue(updates.volumeCurrent);
            if ('volumeTotal' in updates) frontmatterUpdates.volume_total = this.normalizeProgressValue(updates.volumeTotal);
        }

        await this.metadataService.updateMetadata(file, frontmatterUpdates);
        if ('myNotes' in updates) {
            await this.updateMyNotesSection(file, String(updates.myNotes ?? ''));
        }
        this.invalidateCache();
    }

    private async updateMyNotesSection(file: TFile, value: string): Promise<void> {
        const content = await this.app.vault.read(file);
        const next = upsertMarkdownSection(content, 'My Notes', value);
        if (next !== content) {
            await this.app.vault.modify(file, next);
        }
    }

    async deleteItem(item: ReadingItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(item.filePath);
        if (file instanceof TFile) {
            await this.app.fileManager.trashFile(file);
            this.invalidateCache();
        }
    }

    private normalizeMangaParts(
        metadata: Record<string, unknown>,
        fallback: Pick<MangaItem, 'chapterCurrent' | 'chapterTotal' | 'volumeCurrent' | 'volumeTotal' | 'status'>
    ): MangaPart[] {
        const rawParts = Array.isArray(metadata.manga_parts) ? metadata.manga_parts : [];
        const parts = rawParts
            .map((entry, index) => this.parseMangaPart(entry, index))
            .filter((part): part is MangaPart => Boolean(part));
        if (parts.length) return parts;

        if (fallback.volumeCurrent !== null || fallback.volumeTotal !== null || fallback.chapterCurrent !== null || fallback.chapterTotal !== null) {
            return [{
                id: 'main',
                kind: 'volume',
                title: fallback.volumeCurrent ? `Volume ${fallback.volumeCurrent}` : 'Main',
                volumeNumber: fallback.volumeCurrent,
                chapterCurrent: fallback.chapterCurrent,
                chapterTotal: fallback.chapterTotal,
                status: fallback.status,
            }];
        }

        return [];
    }

    private parseMangaPart(raw: unknown, index: number): MangaPart | null {
        if (!raw || typeof raw !== 'object') return null;
        const source = raw as Record<string, unknown>;
        const volumeNumber = parseNumber(source.volumeNumber ?? source.volume ?? source.volume_number);
        const title = this.readText(source, ['title', 'name', 'label']) || (volumeNumber ? `Volume ${volumeNumber}` : `Volume ${index + 1}`);
        return {
            id: this.readText(source, ['id']) || `volume-${volumeNumber ?? index + 1}`,
            kind: 'volume',
            title,
            volumeNumber,
            chapterCurrent: parseNumber(source.chapterCurrent ?? source.chapter_current ?? source.current),
            chapterTotal: parseNumber(source.chapterTotal ?? source.chapter_total ?? source.total),
            status: this.getStatus(this.readText(source, ['status']) || '') ?? 'planned',
        };
    }

    private serializeMangaParts(parts: MangaPart[]): Array<Record<string, unknown>> {
        return parts.map((part) => ({
            id: part.id,
            kind: part.kind,
            title: part.title,
            volume: part.volumeNumber,
            chapter_current: part.chapterCurrent,
            chapter_total: part.chapterTotal,
            status: part.status,
        }));
    }

    private cloneParts(parts: MangaPart[]): MangaPart[] {
        return parts.map((part) => ({ ...part }));
    }

    private areAllMangaPartsCompleted(parts: MangaPart[]): boolean {
        return parts.length > 0 && parts.every((part) => part.status === 'completed');
    }

    private getActivePart(parts: MangaPart[], activePartId: string | null): MangaPart | null {
        if (!parts.length) return null;
        return parts.find((part) => part.id === activePartId) ?? parts[0] ?? null;
    }

    private normalizeActivePartId(parts: MangaPart[], raw: string): string | null {
        if (!parts.length) return null;
        const normalized = raw.trim();
        return parts.some((part) => part.id === normalized) ? normalized : parts[0]?.id ?? null;
    }

    private normalizeProgressValue(value: unknown, total?: number | null): number | null {
        const parsed = parseNumber(value);
        if (parsed === null) return null;
        const rounded = Math.max(0, Math.trunc(parsed));
        return total && total > 0 ? Math.min(rounded, total) : rounded;
    }

    private getStatus(value: string): ReadingStatus | null {
        const normalized = value.trim().toLowerCase();
        return ['planned', 'watching', 'completed', 'dropped', 'paused'].includes(normalized)
            ? normalized as ReadingStatus
            : null;
    }

    private normalizeProvider(value: string): string | null {
        const normalized = value.trim().toLowerCase();
        return ['hardcover', 'googlebooks', 'anilist', 'jikan', 'shikimori', 'mangaupdates', 'mangadex'].includes(normalized)
            ? normalized
            : null;
    }

    private readText(source: Record<string, unknown>, keys: string[]): string {
        for (const key of keys) {
            const value = source[key];
            if (value === null || value === undefined) continue;
            if (Array.isArray(value)) {
                const text = value.map((entry) => String(entry).trim()).filter(Boolean).join(', ');
                if (text) return text;
                continue;
            }
            const text = String(value).trim();
            if (text) return text;
        }
        return '';
    }

    private readDateText(source: Record<string, unknown>, keys: string[]): string | null {
        const text = this.readText(source, keys);
        if (!text) return null;
        return this.normalizeDateString(text) || null;
    }

    private normalizeDateString(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) return '';
        const date = new Date(parsed);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private parseDateString(value: string | null | undefined): number | null {
        if (!value) return null;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    private hasKey(frontmatter: Record<string, unknown> | null | undefined, key: string): boolean {
        return Boolean(frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, key));
    }

    private preferredKey(frontmatter: Record<string, unknown> | null | undefined, keys: string[]): string {
        return keys.find((key) => this.hasKey(frontmatter, key)) ?? keys[0];
    }

    private updateTextField(
        updates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        keys: string[],
        value: unknown
    ): void {
        const key = this.preferredKey(frontmatter, keys);
        const normalized = value === null || value === undefined ? '' : String(value).trim();
        updates[key] = normalized || null;
    }

    private updateDisplayListField(
        updates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        singularKey: string,
        pluralKey: string,
        value: unknown
    ): void {
        const values = this.toDisplayList(value);
        const prefersPlural = this.hasKey(frontmatter, pluralKey) && !this.hasKey(frontmatter, singularKey);

        if (values.length === 0) {
            updates[singularKey] = null;
            updates[pluralKey] = null;
            return;
        }

        if (values.length > 1 || prefersPlural) {
            updates[pluralKey] = values;
            updates[singularKey] = null;
            return;
        }

        updates[singularKey] = values[0];
        if (this.hasKey(frontmatter, pluralKey)) updates[pluralKey] = null;
    }

    private updateListField(
        updates: Record<string, unknown>,
        frontmatter: Record<string, unknown> | null | undefined,
        keys: string[],
        values: unknown,
        removeHashPrefix = false
    ): void {
        const key = this.preferredKey(frontmatter, keys);
        const normalized = this.toStringArray(values)
            .map((value) => (removeHashPrefix ? value.replace(/^#+/, '') : value).trim().toLowerCase())
            .filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);
        updates[key] = normalized.length ? normalized : null;
    }

    private toStringArray(value: unknown): string[] {
        if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
        if (typeof value === 'string') return value.split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean);
        return [];
    }

    private toDisplayList(value: unknown): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const entry of this.toStringArray(value)) {
            const normalized = entry.trim();
            const key = normalized.toLocaleLowerCase();
            if (!normalized || seen.has(key)) continue;
            seen.add(key);
            result.push(normalized);
        }
        return result;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
