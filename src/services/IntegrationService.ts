/**
 * LOREBASE - Integration Service
 * Handles provider search, detail fetching, and note creation.
 */

import { App, Notice, TFile } from 'obsidian';
import { AnimeItem, CommunityRating, GameDlc, GameItem, LorebaseSettings, MediaItem } from '../types';
import { t } from '../localization';
import { ChoiceModal, ExistingFileChoice, ExistingFileChoiceModal, ExistingFilePreview, MultiSelectSearchModal, SearchProviderOption } from '../modals/IntegrationModals';
import { AnimePartsReviewModal } from '../modals/AnimePartsReviewModal';
import { AddModeModal, ManualCreateModal, type ManualCreateDraft } from '../modals/ManualCreateModal';
import { AnimeDetails, BookDetails, GameDetails, IntegrationAnimePart, IntegrationMangaPart, IntegrationVideoPart, MangaDetails, MediaEnrichmentPatch, MediaKind, MediaSourceSelection, ProviderId, SearchResult, VideoDetails } from './integrations/types';
import { buildSimpleTemplate, ensureIntegrationSourceFrontmatter, getDefaultTemplateFields, getEffectiveSimpleTemplateFields, renderTemplate, sanitizeFileName } from './integrations/templateUtils';
import { getAniListDetails, getAniListMangaDetails, searchAniList, searchAniListManga } from './integrations/providers/anilist';
import { getJikanDetails, getLegacyJikanMangaDetails, searchJikan } from './integrations/providers/jikan';
import { getGoogleBooksDetails, searchGoogleBooks } from './integrations/providers/googlebooks';
import { getHardcoverBookDetails, searchHardcoverBooks } from './integrations/providers/hardcover';
import { getIgdbDetails, getIgdbDlcForGame, searchIgdb } from './integrations/providers/igdb';
import { getMangaUpdatesDetails, searchMangaUpdates } from './integrations/providers/mangaupdates';
import { getMangaDexDetails, searchMangaDex } from './integrations/providers/mangadex';
import { getRawgDetails, searchRawg } from './integrations/providers/rawg';
import { getShikimoriDetails, getShikimoriMangaDetails, searchShikimori, searchShikimoriManga } from './integrations/providers/shikimori';
import { getSteamDetails, getSteamDlcForGame, searchSteam } from './integrations/providers/steam';
import { getSteamGridDbPoster } from './integrations/providers/steamgriddb';
import { getOmdbDetails, searchOmdb } from './integrations/providers/omdb';
import { getTmdbDetails, searchTmdb } from './integrations/providers/tmdb';
import { getTvmazeDetails, searchTvmaze } from './integrations/providers/tvmaze';
import { localizeTemplateImages, saveManualImageFileToVault } from './integrations/imageStorage';
import type { JsonFetcher } from './integrations/providers/common';
import {
    ensureFolder,
    fetchHowLongToBeatValues,
    fetchJson,
    getJsonFetcher,
    imageUrlExists,
    isProviderBlockedError,
    renderPartsYaml,
    renderMangaPartsYaml,
    shouldLoadHowLongToBeat,
} from './integrations/shared';
import {
    normalizeCommunityRating,
    sourceIdentity,
    toAnimePartsFrontmatter,
    toMangaPartsFrontmatter,
    toVideoPartsFrontmatter,
} from './integrations/enrichment';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export class IntegrationService {
    private app: App;
    private getSettings: () => LorebaseSettings;
    private runSteamSync?: () => void;
    private jsonFetcher: JsonFetcher;
    private searchCache = new Map<string, { expiresAt: number; results: SearchResult[] }>();

    constructor(app: App, getSettings: () => LorebaseSettings, runSteamSync?: () => void) {
        this.app = app;
        this.getSettings = getSettings;
        this.runSteamSync = runSteamSync;
        this.jsonFetcher = getJsonFetcher((url, headers, method, body) => fetchJson(url, headers, method, body, {
            errorPrefix: 'Integration fetch error:',
            swallowErrors: false,
        }));
    }

    async addGame(): Promise<void> {
        await this.addMedia('games');
    }

    async addAnime(): Promise<void> {
        await this.addMedia('anime');
    }

    async addMovie(): Promise<void> {
        await this.addMedia('movies');
    }

    async addTv(): Promise<void> {
        await this.addMedia('tv');
    }

    async addBook(): Promise<void> {
        await this.addMedia('books');
    }

    async addManga(): Promise<void> {
        await this.addMedia('manga');
    }

    async selectMediaSource(
        kind: MediaKind,
        query: string,
        preferredProvider?: ProviderId
    ): Promise<MediaSourceSelection | null> {
        const settings = this.getSettings();
        const integrations = settings.integrations;
        if (!integrations?.enabled) {
            new Notice(t('noticeIntegrationsDisabled'));
            return null;
        }
        const providerOptions = this.getProviderOptions(kind);
        if (!providerOptions.length) {
            new Notice(t('noticeProviderDisabled'));
            return null;
        }
        const configured = integrations.media[kind].provider;
        const initialProvider = preferredProvider
            ?? (this.isProviderId(configured) ? configured : undefined)
            ?? (this.isProviderId(providerOptions[0]?.id) ? providerOptions[0].id : undefined);
        if (!initialProvider) return null;

        const modal = new MultiSelectSearchModal<SearchResult>(
            this.app,
            async (value, providerId, searchOptions) => {
                if (!providerId || !this.isProviderId(providerId)) return [];
                const providerSettings = integrations.providers[providerId];
                if (!providerSettings?.enabled || !this.hasRequiredCredentials(providerId, providerSettings)) return [];
                return this.search(
                    providerId,
                    value,
                    providerSettings.apiKey || '',
                    providerSettings.clientSecret || '',
                    searchOptions,
                    this.toDetailsKind(kind)
                );
            },
            {
                titleText: this.getSearchTitle(kind),
                placeholder: t('promptSearchPlaceholder'),
                emptyText: t('noticeNoResults'),
                doneText: t('promptConfirmSelected'),
                cancelText: t('commonCancel'),
                providerOptions,
                initialProviderId: initialProvider,
                initialQuery: query,
                maxSelection: 1,
                titleIcon: this.getKindIcon(kind),
                includeDlcToggleText: kind === 'games' ? t('promptIncludeDlc') : undefined,
                imageFallbackResolver: (item) => this.resolveSearchImageFallback(item),
            }
        );
        const selected = await modal.openAndGetValues();
        return selected?.[0] ?? null;
    }

    async getMediaEnrichment(
        kind: MediaKind,
        source: MediaSourceSelection
    ): Promise<MediaEnrichmentPatch | null> {
        const integrations = this.getSettings().integrations;
        if (!integrations?.enabled) return null;
        const providerSettings = integrations.providers[source.provider];
        if (!providerSettings?.enabled) {
            new Notice(t('noticeProviderDisabled'));
            return null;
        }
        if (!this.hasRequiredCredentials(source.provider, providerSettings)) {
            new Notice(t('noticeMissingApiKey'));
            return null;
        }

        const details = await this.fetchDetails(
            source.provider,
            source.id,
            providerSettings.apiKey || '',
            providerSettings.clientSecret || '',
            this.toDetailsKind(kind),
            { includeParts: true }
        );
        if (!details) return null;

        let values: Record<string, unknown>;
        if (kind === 'games' && this.isGameDetails(details)) {
            const built = await this.buildGameValues(
                details,
                shouldLoadHowLongToBeat(integrations.media.games),
                source.image ?? '',
                { provider: source.provider, id: source.id }
            );
            values = {
                ...sourceIdentity(source),
                name: built.name,
                poster: built.Poster,
                poster_b: built.PosterHorizontal,
                plot: built.Plot,
                genres: built.genres,
                platforms: built.platforms,
                developers: built.developers,
                publishers: built.publishers,
                gameSeries: built.gameSeries,
                released: built.released,
                year: built.Year,
                url: built.url,
                main: built.main,
                main_plus_sides: built.main_plus_sides,
                perfectionist: built.perfectionist,
            };
            const dlc = await this.fetchDlcForSource(source);
            if (dlc?.length) values.dlc = dlc;
        } else if (kind === 'anime' && this.isAnimeDetails(details)) {
            const built = this.buildAnimeValues(details, {
                provider: source.provider,
                id: source.id,
                parts: details.parts ?? [],
            });
            values = {
                ...sourceIdentity(source),
                name: built.name,
                poster: built.image,
                poster_b: built.ImageHorizontal,
                plot: built.Plot,
                tags: built.tags,
                year: built.Year,
                studios: built.studios,
                format: built.format,
                url: built.url,
                episode_total: built.episodeTotal,
                anime_parts: toAnimePartsFrontmatter(details.parts),
            };
        } else if ((kind === 'movies' || kind === 'tv') && this.isVideoDetails(details)) {
            const built = this.buildVideoValues(details, { provider: source.provider, id: source.id });
            const partsKey = kind === 'tv' ? 'tv_parts' : 'movie_parts';
            values = {
                ...sourceIdentity(source),
                name: built.name,
                poster: built.Poster,
                poster_b: built.PosterHorizontal,
                plot: built.Plot,
                genres: built.genres,
                year: built.Year,
                released: built.released,
                runtime: built.runtime,
                director: built.director,
                actors: built.actors,
                seasons: built.seasons,
                episode_total: built.episodeTotal,
                networks: built.networks,
                rating: built.rating,
                url: built.url,
                [partsKey]: toVideoPartsFrontmatter(details.parts),
            };
        } else if (kind === 'books' && this.isBookDetails(details)) {
            const built = this.buildBookValues(details, {
                provider: source.provider,
                id: source.id,
                title: source.title,
                year: source.year,
                poster: source.image,
            });
            values = {
                ...sourceIdentity(source),
                name: built.name,
                poster: built.Poster,
                poster_b: built.PosterHorizontal,
                plot: built.Plot,
                authors: built.authors,
                publisher: built.publisher,
                genres: built.genres,
                year: built.Year,
                released: built.released,
                page_total: built.pageTotal,
                url: built.url,
                bookSeries: built.bookSeries,
                seriesPosition: built.seriesPosition,
            };
        } else if (kind === 'manga' && this.isMangaDetails(details)) {
            const built = this.buildMangaValues(details, { provider: source.provider, id: source.id });
            values = {
                ...sourceIdentity(source),
                name: built.name,
                poster: built.Poster,
                poster_b: built.PosterHorizontal,
                plot: built.Plot,
                authors: built.authors,
                artists: built.artists,
                genres: built.genres,
                year: built.Year,
                chapter_total: built.chapterTotal,
                volume_total: built.volumeTotal,
                url: built.url,
                manga_parts: toMangaPartsFrontmatter(details.parts),
            };
        } else {
            return null;
        }

        const detailsRecord = details as unknown as Record<string, unknown>;
        const communityRating = normalizeCommunityRating(
            source.provider,
            detailsRecord.communityRating ?? detailsRecord.imdbRating ?? detailsRecord.rating
        );
        if (communityRating !== null) {
            values.communityRating = communityRating;
            values.communityRatingProvider = this.formatProviderName(source.provider);
            const communityVotes = this.normalizeCommunityVotes(detailsRecord.communityVotes);
            if (communityVotes !== null) values.communityVotes = communityVotes;
        }

        values = await this.localizeEnrichmentImages(kind, String(values.name ?? source.title), values);
        return {
            kind,
            source,
            values,
            filledFields: Object.keys(values),
            skippedFields: [],
        };
    }

    async testProvider(providerId: ProviderId): Promise<{ ok: boolean; reason?: 'missing_key' | 'disabled' | 'no_results' }> {
        const settings = this.getSettings();
        const integrations = settings.integrations;
        if (!integrations || !integrations.enabled) {
            return { ok: false, reason: 'disabled' };
        }

        const providerSettings = integrations.providers[providerId];
        if (!providerSettings?.enabled) {
            return { ok: false, reason: 'disabled' };
        }

        if (!this.hasRequiredCredentials(providerId, providerSettings)) {
            return { ok: false, reason: 'missing_key' };
        }

        const query = providerId === 'rawg' || providerId === 'steam' || providerId === 'igdb'
            ? 'portal'
            : providerId === 'tmdb'
                ? 'matrix'
            : providerId === 'omdb'
                ? 'matrix'
                : providerId === 'tvmaze'
                    ? 'breaking bad'
                : providerId === 'hardcover' || providerId === 'googlebooks'
                    ? 'tolkien'
                : providerId === 'mangaupdates' || providerId === 'mangadex'
                    ? 'berserk'
                : 'naruto';
        const results = await this.search(
            providerId,
            query,
            providerSettings.apiKey || '',
            providerSettings.clientSecret || '',
            {},
            providerId === 'tvmaze'
                ? 'tv'
                : providerId === 'tmdb' || providerId === 'omdb'
                    ? 'movies'
                    : providerId === 'hardcover' || providerId === 'googlebooks'
                        ? 'books'
                        : providerId === 'mangaupdates' || providerId === 'mangadex'
                            ? 'manga'
                            : undefined
        );
        if (!results.length) {
            return { ok: false, reason: 'no_results' };
        }
        return { ok: true };
    }

    private async addMedia(kind: MediaKind): Promise<void> {
        if (this.getSettings().showAddModeChoice === false) {
            await this.addProviderMedia(kind, true);
            return;
        }
        const mode = await new AddModeModal(this.app, kind).openAndGetValue();
        if (!mode) return;
        if (mode === 'manual') {
            await this.addManualMedia(kind);
            return;
        }
        await this.addProviderMedia(kind);
    }

    private async addProviderMedia(kind: MediaKind, allowManualFallback = false): Promise<void> {
        try {
            const settings = this.getSettings();
            const integrations = settings.integrations;
            if (!integrations || !integrations.enabled) {
                new Notice(t('noticeIntegrationsDisabled'));
                return;
            }

            const mediaSettings = integrations.media[kind];
            const providerOptions = this.getProviderOptions(kind);
            if (!providerOptions.some((provider) => !provider.disabled)) {
                new Notice(t('noticeProviderDisabled'));
                return;
            }

            if (!this.isProviderId(mediaSettings.provider)) {
                new Notice(t('noticeProviderDisabled'));
                return;
            }

            const savedProvider = mediaSettings.provider;
            const fallbackProvider = providerOptions[0]?.id;
            const initialProvider = providerOptions.some((provider) => provider.id === savedProvider)
                ? savedProvider
                : this.isProviderId(fallbackProvider)
                    ? fallbackProvider
                    : undefined;
            if (!initialProvider) {
                new Notice(t('noticeProviderDisabled'));
                return;
            }

            const selected = await this.chooseResults(kind, initialProvider, providerOptions, allowManualFallback);
            if (!selected.length) return;

            const template = this.getTemplate(
                kind,
                mediaSettings.templateEnabled,
                mediaSettings.templateMode,
                mediaSettings.templateFields,
                mediaSettings.template,
                mediaSettings.howLongToBeatEnabled ?? false
            );
            const shouldLoadHltb = kind === 'games' && shouldLoadHowLongToBeat(mediaSettings);
            const selectedTitleCounts = this.countSelectedTitles(selected);
            const reservedPaths = new Set<string>();
            const cooldownMs = this.getRequestCooldownMs(integrations.requestCooldownSeconds);
            let hasAttemptedItemRequest = false;

            itemLoop: for (const item of selected) {
                new Notice(t('notifyLoading'), 1500);
                const itemProviderId = item.provider;
                const providerSettings = integrations.providers[itemProviderId];
                if (!providerSettings?.enabled) {
                    new Notice(t('noticeProviderDisabled'));
                    continue;
                }
                if (!this.hasRequiredCredentials(itemProviderId, providerSettings)) {
                    new Notice(t('noticeMissingApiKey'));
                    continue;
                }

                while (true) {
                    if (hasAttemptedItemRequest && cooldownMs > 0) {
                        await this.wait(cooldownMs);
                    }
                    hasAttemptedItemRequest = true;

                    try {
                        const details = await this.fetchDetails(
                            itemProviderId,
                            item.id,
                            providerSettings.apiKey || '',
                            providerSettings.clientSecret || '',
                            this.toDetailsKind(kind),
                            { includeParts: kind !== 'anime' }
                        );
                        if (!details) {
                            new Notice(t('noticeNoResults'));
                            continue itemLoop;
                        }

                        let values: Record<string, unknown>;
                        if (kind === 'games') {
                            if (!this.isGameDetails(details)) {
                                new Notice(t('noticeNoResults'));
                                continue itemLoop;
                            }
                            values = await this.buildGameValues(details, shouldLoadHltb, item.image, {
                                provider: itemProviderId,
                                id: item.id,
                            });
                        } else if (kind === 'anime') {
                            if (!this.isAnimeDetails(details)) {
                                new Notice(t('noticeNoResults'));
                                continue itemLoop;
                            }
                            values = this.buildAnimeValues(details, {
                                provider: itemProviderId,
                                id: item.id,
                                parts: [],
                            });
                        } else if (kind === 'books') {
                            if (!this.isBookDetails(details)) {
                                new Notice(t('noticeNoResults'));
                                continue itemLoop;
                            }
                            values = this.buildBookValues(details, {
                                provider: itemProviderId,
                                id: item.id,
                                title: item.title,
                                year: item.year,
                                poster: item.image,
                            });
                        } else if (kind === 'manga') {
                            if (!this.isMangaDetails(details)) {
                                new Notice(t('noticeNoResults'));
                                continue itemLoop;
                            }
                            values = this.buildMangaValues(details, {
                                provider: itemProviderId,
                                id: item.id,
                            });
                        } else {
                            if (!this.isVideoDetails(details)) {
                                new Notice(t('noticeNoResults'));
                                continue itemLoop;
                            }
                            values = this.buildVideoValues(details, {
                                provider: itemProviderId,
                                id: item.id,
                            });
                        }

                        const title = this.firstStringValue(values, 'name', item.title, 'Untitled');
                        const renderedValues = template
                            ? await localizeTemplateImages(this.app, kind, title, values, integrations.imageStorage, template)
                            : values;
                        let content: string = template
                            ? renderTemplate(template, renderedValues)
                            : `# ${title}\n`;
                        if (this.needsFrontmatterFallback(kind, content)) {
                            const fallbackTemplate = buildSimpleTemplate(kind, getDefaultTemplateFields(kind));
                            content = `${renderTemplate(fallbackTemplate, renderedValues)}\n\n${content.trim()}`;
                        }
                        content = ensureIntegrationSourceFrontmatter(content, itemProviderId, item.id);
                        const folderPath = this.getFolderPath(settings, kind);
                        let pathChoice = this.resolveCreatePath(folderPath, title, {
                            preferYear: (selectedTitleCounts.get(this.titleKey(item.title)) ?? 0) > 1,
                            year: this.firstStringValue(values, 'year', item.year ?? ''),
                            provider: itemProviderId,
                            id: item.id,
                            reservedPaths,
                        });

                        const exists = pathChoice.existing;
                        if (exists instanceof TFile) {
                            const choice = await this.confirmExistingFile(exists.path, {
                                title,
                                meta: this.buildExistingFileMeta(kind, itemProviderId, this.firstStringValue(values, 'year', item.year ?? '')),
                                image: this.firstStringValue(renderedValues, 'poster', item.image ?? ''),
                            });
                            if (choice === 'skip') {
                                new Notice(t('noticeSkipped'));
                                continue itemLoop;
                            }
                            if (choice === 'update') {
                                await this.app.vault.modify(exists, content);
                                new Notice(t('noticeCreated'));
                                continue itemLoop;
                            }
                            pathChoice = this.resolveCreatePath(folderPath, title, {
                                preferYear: true,
                                year: this.firstStringValue(values, 'year', item.year ?? ''),
                                provider: itemProviderId,
                                id: item.id,
                                reservedPaths,
                                ignoreExistingBase: true,
                            });
                        }

                        await ensureFolder(this.app, folderPath);
                        await this.app.vault.create(pathChoice.fullPath, content);
                        reservedPaths.add(pathChoice.fullPath);
                        new Notice(t('noticeCreated'));
                        continue itemLoop;
                    } catch (error: unknown) {
                        if (!isProviderBlockedError(error)) throw error;
                        await this.confirmRateLimit(error);
                        break itemLoop;
                    }
                }
            }
        } catch (error: unknown) {
            console.error('Integration add error:', error);
            const message = error instanceof Error ? `: ${error.message}` : '';
            new Notice(`${t('noticeIntegrationsError')}${message}`);
        }
    }

    private async addManualMedia(defaultKind: MediaKind): Promise<void> {
        try {
            const draft = await new ManualCreateModal(this.app, defaultKind).openAndGetValue();
            if (!draft) return;

            const settings = this.getSettings();
            const integrations = settings.integrations;
            const preparedDraft = await this.prepareManualDraft(draft, settings);
            const kind = preparedDraft.kind;
            const mediaSettings = integrations?.media[kind];
            const template = mediaSettings
                ? this.getTemplate(
                    kind,
                    mediaSettings.templateEnabled,
                    mediaSettings.templateMode,
                    mediaSettings.templateFields,
                    mediaSettings.template,
                    mediaSettings.howLongToBeatEnabled ?? false
                )
                : buildSimpleTemplate(kind, getDefaultTemplateFields(kind));
            const values = this.buildManualValues(preparedDraft);
            const title = this.firstStringValue(values, 'name', preparedDraft.title, 'Untitled');
            const renderedValues = template && integrations
                ? await localizeTemplateImages(this.app, kind, title, values, integrations.imageStorage, template)
                : values;
            let content: string = template
                ? renderTemplate(template, renderedValues)
                : `# ${title}\n`;
            if (!this.hasFrontmatter(content)) {
                const fallbackTemplate = buildSimpleTemplate(kind, getDefaultTemplateFields(kind));
                content = `${renderTemplate(fallbackTemplate, renderedValues)}\n\n${content.trim()}`;
            }

            const folderPath = this.getFolderPath(settings, kind);
            let pathChoice = this.resolveCreatePath(folderPath, title, {
                year: this.firstStringValue(values, 'year', preparedDraft.year),
            });
            const existing = pathChoice.existing;
            let file: TFile | null = null;
            if (existing instanceof TFile) {
                const choice = await this.confirmExistingFile(existing.path);
                if (choice === 'skip') {
                    new Notice(t('noticeSkipped'));
                    return;
                }
                if (choice === 'update') {
                    await this.app.vault.modify(existing, content);
                    file = existing;
                } else {
                    pathChoice = this.resolveCreatePath(folderPath, title, {
                        preferYear: true,
                        year: this.firstStringValue(values, 'year', preparedDraft.year),
                        ignoreExistingBase: true,
                    });
                    await ensureFolder(this.app, folderPath);
                    file = await this.app.vault.create(pathChoice.fullPath, content);
                }
            } else {
                await ensureFolder(this.app, folderPath);
                file = await this.app.vault.create(pathChoice.fullPath, content);
            }

            new Notice(t('noticeCreated'));
            if (file) {
                await this.app.workspace.getLeaf(true).openFile(file);
            }
        } catch (error: unknown) {
            console.error('Manual add error:', error);
            const message = error instanceof Error ? `: ${error.message}` : '';
            new Notice(`${t('noticeIntegrationsError')}${message}`);
        }
    }

    private async confirmExistingFile(filePath: string, preview?: ExistingFilePreview): Promise<ExistingFileChoice> {
        const modal = new ExistingFileChoiceModal(
            this.app,
            t('promptFileExistsTitle'),
            t('promptFileExistsBody'),
            filePath,
            preview
        );
        return modal.openAndGetValue();
    }

    private async confirmRateLimit(error?: unknown): Promise<void> {
        const detail = error instanceof Error && error.message
            ? `\n\n${error.message}`
            : '';
        const modal = new ChoiceModal(
            this.app,
            t('promptRateLimitTitle'),
            `${t('promptRateLimitBody')}${detail}`,
            t('commonOk'),
            t('commonCancel')
        );
        await modal.openAndGetValue();
    }

    private getRequestCooldownMs(value: unknown): number {
        const seconds = typeof value === 'number' && Number.isFinite(value) ? value : 1;
        return Math.round(Math.min(30, Math.max(0, seconds)) * 1000);
    }

    private wait(milliseconds: number): Promise<void> {
        return new Promise(resolve => window.setTimeout(resolve, milliseconds));
    }

    private buildExistingFileMeta(kind: MediaKind, provider: string, year: string): string[] {
        return [
            year,
            this.getMediaKindLabel(kind),
            this.formatProviderName(provider),
        ].map(part => part.trim()).filter(Boolean);
    }

    private getMediaKindLabel(kind: MediaKind): string {
        const labels: Record<MediaKind, string> = {
            games: t('settingsPreviewGame'),
            anime: t('settingsPreviewAnime'),
            movies: t('settingsPreviewMovie'),
            tv: t('settingsPreviewTv'),
            books: t('settingsPreviewBook'),
            manga: t('settingsPreviewManga'),
        };
        return labels[kind] ?? kind;
    }

    private getSearchTitle(kind: MediaKind): string {
        if (kind === 'games') return t('promptSearchGame');
        if (kind === 'anime') return t('promptSearchAnime');
        if (kind === 'movies') return t('promptSearchMovie');
        if (kind === 'tv') return t('promptSearchTv');
        if (kind === 'books') return t('promptSearchBook');
        return t('promptSearchManga');
    }

    private getKindIcon(kind: MediaKind): string {
        if (kind === 'games') return 'gamepad-2';
        if (kind === 'anime') return 'clapperboard';
        if (kind === 'movies') return 'film';
        if (kind === 'tv') return 'tv';
        if (kind === 'books') return 'book-open';
        return 'book-open-text';
    }

    private async fetchDlcForSource(source: MediaSourceSelection): Promise<GameDlc[] | null> {
        if (source.provider === 'steam') {
            return getSteamDlcForGame(this.jsonFetcher, source.id);
        }
        if (source.provider === 'igdb') {
            const settings = this.getSettings().integrations?.providers.igdb;
            if (!settings?.enabled || !this.hasRequiredCredentials('igdb', settings)) return null;
            return getIgdbDlcForGame(
                this.jsonFetcher,
                source.id,
                settings.apiKey || '',
                settings.clientSecret || ''
            );
        }
        return null;
    }

    private async localizeEnrichmentImages(
        kind: MediaKind,
        title: string,
        values: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const imageStorage = this.getSettings().integrations?.imageStorage;
        if (kind === 'anime') {
            const localized = await localizeTemplateImages(
                this.app,
                kind,
                title,
                { image: values.poster, ImageHorizontal: values.poster_b },
                imageStorage,
                '{{VALUE:image}}\n{{VALUE:ImageHorizontal}}'
            );
            return { ...values, poster: localized.image, poster_b: localized.ImageHorizontal };
        }
        const localized = await localizeTemplateImages(
            this.app,
            kind,
            title,
            { Poster: values.poster, PosterHorizontal: values.poster_b },
            imageStorage,
            '{{VALUE:Poster}}\n{{VALUE:PosterHorizontal}}'
        );
        return { ...values, poster: localized.Poster, poster_b: localized.PosterHorizontal };
    }

    private formatProviderName(provider: string): string {
        const labels: Record<string, string> = {
            steam: 'Steam',
            rawg: 'RAWG',
            igdb: 'IGDB',
            anilist: 'AniList',
            jikan: 'Jikan',
            shikimori: 'Shikimori',
            tmdb: 'TMDB',
            omdb: 'OMDb',
            tvmaze: 'TVmaze',
            hardcover: 'Hardcover',
            googlebooks: 'Google Books',
            mangaupdates: 'MangaUpdates',
            mangadex: 'MangaDex',
        };
        return labels[provider.toLowerCase()] ?? provider;
    }

    private countSelectedTitles(items: SearchResult[]): Map<string, number> {
        const counts = new Map<string, number>();
        for (const item of items) {
            const key = this.titleKey(item.title);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }

    private titleKey(value: string): string {
        return value.trim().toLowerCase();
    }

    private resolveCreatePath(
        folderPath: string,
        title: string,
        options: {
            preferYear?: boolean;
            year?: string;
            provider?: string;
            id?: string;
            reservedPaths?: Set<string>;
            ignoreExistingBase?: boolean;
        } = {}
    ): { fullPath: string; existing: TFile | null } {
        const candidates = this.getFileNameCandidates(title, options);
        const fallback = candidates[0] ?? 'Untitled';
        let fallbackExisting: TFile | null = null;
        let fallbackPath = this.joinMediaPath(folderPath, fallback);
        const basePath = this.joinMediaPath(folderPath, sanitizeFileName(title) || 'Untitled');
        const baseExisting = this.app.vault.getAbstractFileByPath(basePath);
        if (!options.ignoreExistingBase && baseExisting instanceof TFile) {
            return { fullPath: basePath, existing: baseExisting };
        }

        for (const fileName of candidates) {
            const fullPath = this.joinMediaPath(folderPath, fileName);
            const existing = this.app.vault.getAbstractFileByPath(fullPath);
            if (!fallbackExisting && existing instanceof TFile) {
                fallbackExisting = existing;
                fallbackPath = fullPath;
            }
            if (!(existing instanceof TFile) && !options.reservedPaths?.has(fullPath)) {
                return { fullPath, existing: null };
            }
        }

        for (let index = 2; index < 1000; index++) {
            const fullPath = this.joinMediaPath(folderPath, `${fallback} ${index}`);
            const existing = this.app.vault.getAbstractFileByPath(fullPath);
            if (!(existing instanceof TFile) && !options.reservedPaths?.has(fullPath)) {
                return { fullPath, existing: null };
            }
        }

        return { fullPath: fallbackPath, existing: fallbackExisting };
    }

    private getFileNameCandidates(
        title: string,
        options: { preferYear?: boolean; year?: string; provider?: string; id?: string }
    ): string[] {
        const base = sanitizeFileName(title) || 'Untitled';
        const year = this.sanitizePathSuffix(options.year);
        const source = this.sanitizePathSuffix([options.provider, options.id].filter(Boolean).join('-'));
        const candidates: string[] = [];
        const push = (value: string): void => {
            const sanitized = sanitizeFileName(value) || 'Untitled';
            if (!candidates.includes(sanitized)) candidates.push(sanitized);
        };

        if (options.preferYear && year) push(`${base} ${year}`);
        push(base);
        if (year) push(`${base} ${year}`);
        if (source) push(year ? `${base} ${year} ${source}` : `${base} ${source}`);
        return candidates;
    }

    private sanitizePathSuffix(value: unknown): string {
        return String(value ?? '').trim().replace(/[\\/]/g, '-');
    }

    private joinMediaPath(folderPath: string, fileName: string): string {
        return folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
    }

    private getFolderPath(settings: LorebaseSettings, kind: MediaKind): string {
        switch (kind) {
            case 'games':
                return settings.games.folderPath;
            case 'anime':
                return settings.anime.folderPath;
            case 'movies':
                return settings.movies.folderPath;
            case 'tv':
                return settings.tv.folderPath;
            case 'books':
                return settings.books.folderPath;
            case 'manga':
                return settings.manga.folderPath;
        }
    }

    private toDetailsKind(kind: MediaKind): 'movies' | 'tv' | 'books' | 'manga' | undefined {
        return kind === 'movies' || kind === 'tv' || kind === 'books' || kind === 'manga'
            ? kind
            : undefined;
    }

    private toVideoKind(kind: 'movies' | 'tv' | 'books' | 'manga' | undefined): 'movies' | 'tv' {
        return kind === 'tv' ? 'tv' : 'movies';
    }

    private async chooseResults(
        kind: MediaKind,
        initialProviderId: ProviderId,
        providerOptions: SearchProviderOption[],
        allowManualFallback = false
    ): Promise<SearchResult[]> {
        const modal = new MultiSelectSearchModal<SearchResult>(
            this.app,
            async (query, providerId, searchOptions) => {
                if (!providerId || !this.isProviderId(providerId)) return [];
                const selectedProviderId = providerId;
                const providerSettings = this.getSettings().integrations?.providers[selectedProviderId];
                if (!providerSettings?.enabled) return [];
                if (!this.hasRequiredCredentials(selectedProviderId, providerSettings)) return [];
                new Notice(t('notifyLoading'), 1200);
                return this.search(
                    selectedProviderId,
                    query,
                    providerSettings.apiKey || '',
                    providerSettings.clientSecret || '',
                    searchOptions,
                    this.toDetailsKind(kind)
                );
            },
            {
                titleText: kind === 'games'
                    ? t('promptSearchGame')
                    : kind === 'anime'
                        ? t('promptSearchAnime')
                        : kind === 'movies'
                            ? t('promptSearchMovie')
                            : kind === 'tv'
                                ? t('promptSearchTv')
                                : kind === 'books'
                                    ? t('promptSearchBook')
                                    : t('promptSearchManga'),
                placeholder: t('promptSearchPlaceholder'),
                emptyText: t('noticeNoResults'),
                doneText: t('promptAddSelected'),
                cancelText: t('commonCancel'),
                providerOptions,
                initialProviderId,
                titleIcon: kind === 'games'
                    ? 'gamepad-2'
                    : kind === 'anime'
                        ? 'clapperboard'
                        : kind === 'movies'
                            ? 'film'
                            : kind === 'tv'
                                ? 'tv'
                                : kind === 'books'
                                    ? 'book-open'
                                    : 'book-open-text',
                syncActionText: kind === 'games' ? 'Steam Sync' : undefined,
                onSyncAction: kind === 'games' ? this.runSteamSync : undefined,
                manualActionText: allowManualFallback ? t('promptAddModeManual') : undefined,
                onManualAction: allowManualFallback ? () => {
                    void this.addManualMedia(kind);
                } : undefined,
                includeDlcToggleText: kind === 'games' ? t('promptIncludeDlc') : undefined,
                imageFallbackResolver: (item) => this.resolveSearchImageFallback(item),
            }
        );
        return (await modal.openAndGetValues()) ?? [];
    }

    private async resolveSearchImageFallback(item: SearchResult): Promise<string> {
        if (item.provider !== 'steam' || !item.id) return '';
        const options = this.getSettings().integrations?.providers.steamgriddb;
        return getSteamGridDbPoster(this.jsonFetcher, item.id, options);
    }

    private requiresApiKey(provider: ProviderId): boolean {
        return provider === 'rawg'
            || provider === 'igdb'
            || provider === 'tmdb'
            || provider === 'omdb'
            || provider === 'hardcover'
            || provider === 'googlebooks';
    }

    private hasRequiredCredentials(
        provider: ProviderId,
        settings: { apiKey?: string; clientSecret?: string } | undefined
    ): boolean {
        if (provider === 'igdb') {
            return Boolean(settings?.apiKey && settings.clientSecret);
        }
        if (this.requiresApiKey(provider)) {
            return Boolean(settings?.apiKey);
        }
        return true;
    }

    private getProviderOptions(kind: MediaKind): SearchProviderOption[] {
        const providers: Array<{ id: ProviderId; label: string }> = kind === 'games'
            ? [
                { id: 'rawg', label: 'RAWG' },
                { id: 'steam', label: 'Steam' },
                { id: 'igdb', label: 'IGDB' },
            ]
            : kind === 'anime'
                ? [
                { id: 'anilist', label: 'AniList' },
                { id: 'jikan', label: 'Jikan' },
                { id: 'shikimori', label: 'Shikimori' },
                ]
                : kind === 'movies'
                    ? [
                        { id: 'tmdb', label: 'TMDB' },
                        { id: 'omdb', label: 'OMDb' },
                    ]
                    : kind === 'tv'
                        ? [
                        { id: 'tmdb', label: 'TMDB' },
                        { id: 'tvmaze', label: 'TVmaze' },
                        { id: 'omdb', label: 'OMDb' },
                        ]
                        : kind === 'books'
                            ? [
                                { id: 'hardcover', label: 'Hardcover' },
                                { id: 'googlebooks', label: 'Google Books' },
                            ]
                            : [
                                { id: 'anilist', label: 'AniList' },
                                { id: 'shikimori', label: 'Shikimori' },
                                { id: 'mangaupdates', label: 'MangaUpdates' },
                                { id: 'mangadex', label: 'MangaDex' },
                            ];
        const integrations = this.getSettings().integrations;

        return providers
            .filter((provider) => {
                const settings = integrations?.providers[provider.id];
                return Boolean(settings?.enabled && this.hasRequiredCredentials(provider.id, settings));
            })
            .map((provider) => ({
                id: provider.id,
                label: provider.label,
            }));
    }

    private isProviderId(value: string | undefined): value is ProviderId {
        return value === 'rawg'
            || value === 'steam'
            || value === 'igdb'
            || value === 'anilist'
            || value === 'jikan'
            || value === 'shikimori'
            || value === 'tmdb'
            || value === 'tvmaze'
            || value === 'omdb'
            || value === 'hardcover'
            || value === 'googlebooks'
            || value === 'mangaupdates'
            || value === 'mangadex';
    }

    private isGameDetails(value: GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails): value is GameDetails {
        return value.kind === 'game';
    }

    private isAnimeDetails(value: GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails): value is AnimeDetails {
        return value.kind === 'anime';
    }

    private isVideoDetails(value: GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails): value is VideoDetails {
        return value.kind === 'video';
    }

    private isBookDetails(value: GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails): value is BookDetails {
        return value.kind === 'book';
    }

    private isMangaDetails(value: GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails): value is MangaDetails {
        return value.kind === 'manga';
    }

    private getTemplate(
        kind: MediaKind,
        enabled: boolean,
        mode: string | undefined,
        fields: string[] | undefined,
        advancedTemplate: string,
        howLongToBeatEnabled: boolean
    ): string | null {
        if (!enabled) {
            if (kind === 'movies' || kind === 'tv' || kind === 'books' || kind === 'manga') {
                return buildSimpleTemplate(kind, getDefaultTemplateFields(kind));
            }
            return null;
        }
        const templateMode = mode ?? 'simple';
        if (templateMode === 'advanced' && advancedTemplate.trim()) {
            return advancedTemplate;
        }
        const selected = Array.isArray(fields) ? fields : getDefaultTemplateFields(kind);
        return buildSimpleTemplate(kind, getEffectiveSimpleTemplateFields(kind, selected, { howLongToBeatEnabled }));
    }

    private async search(
        provider: ProviderId,
        query: string,
        apiKey: string,
        clientSecret = '',
        options: { includeDlc?: boolean; page?: number; pageSize?: number } = {},
        kind?: 'movies' | 'tv' | 'books' | 'manga'
    ): Promise<SearchResult[]> {
        const cacheKey = [
            provider,
            kind ?? '',
            query.trim().toLowerCase(),
            options.includeDlc ? 'dlc' : 'base',
            options.page ?? 1,
            options.pageSize ?? 10,
        ].join('|');
        const cached = this.searchCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) return cached.results;

        const fetchJson = this.jsonFetcher;
        let results: SearchResult[];
        switch (provider) {
            case 'rawg':
                results = await searchRawg(fetchJson, query, apiKey, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'steam':
                results = await searchSteam(fetchJson, query, {
                    includeDlc: options.includeDlc,
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'igdb':
                results = await searchIgdb(fetchJson, query, apiKey, clientSecret, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'anilist':
                if (kind === 'manga') {
                    results = await searchAniListManga(fetchJson, query, {
                        page: options.page,
                        pageSize: options.pageSize,
                    });
                    break;
                }
                results = await searchAniList(fetchJson, query, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'jikan':
                results = await searchJikan(fetchJson, query, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'shikimori':
                if (kind === 'manga') {
                    results = await searchShikimoriManga(fetchJson, query, {
                        page: options.page,
                        pageSize: options.pageSize,
                    });
                    break;
                }
                results = await searchShikimori(fetchJson, query, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'hardcover':
                results = await searchHardcoverBooks(fetchJson, query, apiKey, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'googlebooks':
                results = await searchGoogleBooks(fetchJson, query, apiKey, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'mangaupdates':
                results = await searchMangaUpdates(fetchJson, query, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'mangadex':
                results = await searchMangaDex(fetchJson, query, {
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'tmdb':
                results = await searchTmdb(fetchJson, query, apiKey, {
                    kind: this.toVideoKind(kind),
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'tvmaze':
                results = await searchTvmaze(fetchJson, query, apiKey, {
                    kind: this.toVideoKind(kind),
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            case 'omdb':
                results = await searchOmdb(fetchJson, query, apiKey, {
                    kind: this.toVideoKind(kind),
                    page: options.page,
                    pageSize: options.pageSize,
                });
                break;
            default:
                results = [];
        }

        const cacheTtlMs = provider === 'mangaupdates' ? 20 * 60_000 : 60_000;
        this.searchCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, results });
        if (this.searchCache.size > 80) {
            let oldestKey: string | undefined;
            for (const key of this.searchCache.keys()) {
                oldestKey = key;
                break;
            }
            if (oldestKey) this.searchCache.delete(oldestKey);
        }
        return results;
    }

    private async fetchDetails(
        provider: ProviderId,
        id: string,
        apiKey: string,
        clientSecret = '',
        kind?: 'movies' | 'tv' | 'books' | 'manga',
        options: { includeParts?: boolean } = {}
    ): Promise<GameDetails | AnimeDetails | VideoDetails | BookDetails | MangaDetails | null> {
        const fetchJson = this.jsonFetcher;
        switch (provider) {
            case 'rawg':
                return getRawgDetails(fetchJson, id, apiKey);
            case 'steam':
                return getSteamDetails(fetchJson, id, {
                    steamGridDb: this.getSettings().integrations?.providers.steamgriddb,
                    imageExists: imageUrlExists,
                });
            case 'igdb':
                return getIgdbDetails(fetchJson, id, apiKey, clientSecret);
            case 'anilist':
                if (kind === 'manga') return getAniListMangaDetails(fetchJson, id);
                return getAniListDetails(fetchJson, id, options);
            case 'jikan':
                if (kind === 'manga') return getLegacyJikanMangaDetails(fetchJson, id);
                return getJikanDetails(fetchJson, id, options);
            case 'shikimori':
                if (kind === 'manga') return getShikimoriMangaDetails(fetchJson, id);
                return getShikimoriDetails(fetchJson, id, options);
            case 'hardcover':
                return getHardcoverBookDetails(fetchJson, id, apiKey);
            case 'googlebooks':
                return getGoogleBooksDetails(fetchJson, id, apiKey);
            case 'mangaupdates':
                return getMangaUpdatesDetails(fetchJson, id);
            case 'mangadex':
                return getMangaDexDetails(fetchJson, id);
            case 'tmdb':
                return getTmdbDetails(fetchJson, id, apiKey, this.toVideoKind(kind));
            case 'tvmaze':
                return getTvmazeDetails(fetchJson, id, apiKey, this.toVideoKind(kind));
            case 'omdb':
                return getOmdbDetails(fetchJson, id, apiKey, this.toVideoKind(kind));
            default:
                return null;
        }
    }

    async fetchAnimePartsForItem(anime: AnimeItem): Promise<IntegrationAnimePart[] | null> {
        const provider = anime.integrationProvider;
        const id = anime.integrationId;
        if (!provider || !id) return null;

        const providerSettings = this.getSettings().integrations?.providers[provider];
        if (!providerSettings?.enabled || !this.hasRequiredCredentials(provider, providerSettings)) return null;

        const details = await this.fetchDetails(
            provider,
            id,
            providerSettings.apiKey || '',
            providerSettings.clientSecret || ''
        );
        if (!details || !this.isAnimeDetails(details)) return null;
        return this.getAnimeParts(details);
    }

    async reviewAnimePartsForItem(anime: AnimeItem, providerParts: IntegrationAnimePart[]): Promise<{
        parts: IntegrationAnimePart[];
        activePartId: string | null;
        status: AnimeItem['status'];
    } | null> {
        return this.reviewAnimeParts({ ...this.detailsFromAnime(anime), parts: providerParts }, {
            provider: anime.integrationProvider ?? 'anilist',
            id: anime.integrationId ?? '',
            title: anime.displayName,
            existingParts: anime.parts ?? [],
            activePartId: anime.activePartId ?? null,
            status: anime.status,
            markNewParts: true,
        });
    }

    async fetchGameDlcForItem(game: GameItem): Promise<GameDlc[] | null> {
        const igdbId = (game.integrationProvider === 'igdb' ? game.integrationId : null)
            || this.readIgdbIdFromUrl(game.sourceUrl ?? '');
        if (igdbId) {
            const providerSettings = this.getSettings().integrations?.providers.igdb;
            if (!providerSettings?.enabled || !this.hasRequiredCredentials('igdb', providerSettings)) return null;
            return getIgdbDlcForGame(
                this.jsonFetcher,
                igdbId,
                providerSettings.apiKey || '',
                providerSettings.clientSecret || ''
            );
        }

        const steamId = game.steamAppId
            || (game.integrationProvider === 'steam' ? game.integrationId : null)
            || this.readSteamIdFromUrl(game.sourceUrl ?? '');
        if (!steamId) return null;

        const providerSettings = this.getSettings().integrations?.providers.steam;
        if (!providerSettings?.enabled) return null;

        return getSteamDlcForGame(this.jsonFetcher, steamId, {
            existing: game.dlc ?? [],
        });
    }

    async fetchCommunityRatingForItem(item: MediaItem): Promise<CommunityRating | null> {
        const source = this.getCommunityRatingSource(item);
        if (!source) return null;

        if (source.provider === 'mal') return null;

        if (source.provider === 'steam') {
            return this.fetchSteamCommunityRating(source.id);
        }

        const providerSettings = this.getSettings().integrations?.providers[source.provider];
        if (!providerSettings?.enabled || !this.hasRequiredCredentials(source.provider, providerSettings)) return null;

        const details = await this.fetchDetails(
            source.provider,
            source.id,
            providerSettings.apiKey || '',
            providerSettings.clientSecret || '',
            source.kind
        );
        if (!details) return null;

        const record = details as unknown as Record<string, unknown>;
        const rating = normalizeCommunityRating(
            source.provider,
            record.communityRating ?? record.imdbRating ?? record.rating
        );
        if (rating === null) return null;

        return {
            provider: this.getCommunityProviderLabel(source.provider),
            rating,
            votes: this.normalizeCommunityVotes(record.communityVotes),
        };
    }

    private getCommunityRatingSource(item: MediaItem): {
        provider: ProviderId | 'mal';
        id: string;
        kind?: 'movies' | 'tv' | 'books' | 'manga';
    } | null {
        const provider = this.getItemProvider(item);
        const id = this.getItemProviderId(item);
        if (provider && id) {
            return { provider, id, kind: this.getDetailsKindForItem(item) };
        }

        const url = this.getItemSourceUrl(item);
        if (!url) return null;

        const mal = url.match(/myanimelist\.net\/(anime|manga)\/(\d+)/i);
        if (mal?.[1] && mal[2]) {
            return { provider: 'mal', id: mal[2], kind: mal[1].toLowerCase() === 'manga' ? 'manga' : undefined };
        }

        const anilist = url.match(/anilist\.co\/(anime|manga)\/(\d+)/i);
        if (anilist?.[1] && anilist[2]) {
            return { provider: 'anilist', id: anilist[2], kind: anilist[1].toLowerCase() === 'manga' ? 'manga' : undefined };
        }

        const shikimori = url.match(/shikimori\.(?:net|one|io)\/(animes|mangas)\/(\d+)/i);
        if (shikimori?.[1] && shikimori[2]) {
            return { provider: 'shikimori', id: shikimori[2], kind: shikimori[1].toLowerCase() === 'mangas' ? 'manga' : undefined };
        }

        const tmdb = url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
        if (tmdb?.[1] && tmdb[2]) {
            return { provider: 'tmdb', id: tmdb[2], kind: tmdb[1].toLowerCase() === 'tv' ? 'tv' : 'movies' };
        }

        const rawg = url.match(/rawg\.io\/games\/([^/?#]+)/i);
        if (rawg?.[1]) {
            return { provider: 'rawg', id: rawg[1] };
        }

        const steam = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
        if (steam?.[1]) {
            return { provider: 'steam', id: steam[1] };
        }

        const igdb = url.match(/igdb\.com\/games\/(\d+)/i);
        if (igdb?.[1]) {
            return { provider: 'igdb', id: igdb[1] };
        }

        return null;
    }

    private getItemProvider(item: MediaItem): ProviderId | null {
        const provider = item.integrationProvider;
        return typeof provider === 'string' && this.isProviderId(provider) ? provider : null;
    }

    private getItemProviderId(item: MediaItem): string | null {
        const id = item.integrationId;
        return id ? String(id).trim() || null : null;
    }

    private getItemSourceUrl(item: MediaItem): string {
        if ('sourceUrl' in item && item.sourceUrl) return item.sourceUrl;
        return '';
    }

    private getDetailsKindForItem(item: MediaItem): 'movies' | 'tv' | 'books' | 'manga' | undefined {
        if (item.type === 'movie') return 'movies';
        if (item.type === 'tv') return 'tv';
        if (item.type === 'book') return 'books';
        if (item.type === 'manga') return 'manga';
        return undefined;
    }

    private async fetchSteamCommunityRating(id: string): Promise<CommunityRating | null> {
        const url = new URL(`https://store.steampowered.com/appreviews/${encodeURIComponent(id)}`);
        url.searchParams.set('json', '1');
        url.searchParams.set('language', 'all');
        url.searchParams.set('purchase_type', 'all');
        const root = asRecord(await this.jsonFetcher(url.toString(), { 'Accept': 'application/json' }));
        const summary = asRecord(root?.query_summary);
        if (!summary) return null;
        const positive = this.normalizeCommunityVotes(summary.total_positive);
        const reviews = this.normalizeCommunityVotes(summary.total_reviews);
        if (!positive || !reviews) return null;
        return {
            provider: 'Steam',
            rating: Math.round((positive / reviews) * 1000) / 10,
            votes: reviews,
        };
    }

    private normalizeCommunityVotes(value: unknown): number | null {
        const number = this.toNumberOrNull(value);
        return number === null ? null : Math.max(0, Math.trunc(number));
    }

    private toNumberOrNull(value: unknown): number | null {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (value === null || value === undefined) return null;
        const parsed = Number.parseFloat(String(value).replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : null;
    }

    private getCommunityProviderLabel(provider: ProviderId | 'mal'): string {
        if (provider === 'mal') return 'MAL';
        if (provider === 'anilist') return 'AniList';
        if (provider === 'jikan') return 'Jikan / MAL';
        if (provider === 'tmdb') return 'TMDB';
        if (provider === 'omdb') return 'IMDb';
        if (provider === 'rawg') return 'RAWG';
        if (provider === 'googlebooks') return 'Google Books';
        if (provider === 'hardcover') return 'Hardcover';
        if (provider === 'steam') return 'Steam';
        if (provider === 'igdb') return 'IGDB';
        if (provider === 'shikimori') return 'Shikimori';
        if (provider === 'mangaupdates') return 'MangaUpdates';
        if (provider === 'mangadex') return 'MangaDex';
        return provider;
    }

    private readSteamIdFromUrl(url: string): string | null {
        const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
        return match?.[1] ?? null;
    }

    private readIgdbIdFromUrl(url: string): string | null {
        const match = url.match(/igdb\.com\/games\/(\d+)/i);
        return match?.[1] ?? null;
    }

    private async buildGameValues(
        details: GameDetails,
        includeHowLongToBeat: boolean,
        fallbackImage = '',
        source?: { provider?: ProviderId; id?: string }
    ): Promise<Record<string, unknown>> {
        const hltb = includeHowLongToBeat
            ? await fetchHowLongToBeatValues(this.jsonFetcher, details.name, details.year, '[Integrations]')
            : null;
        // Details contain a verified Steam portrait or the configured
        // SteamGridDB result. Search artwork is only a preview fallback and
        // must never override that resolved image.
        const poster = details.poster || fallbackImage;

        return {
            name: details.name,
            Poster: poster,
            PosterHorizontal: details.posterHorizontal || poster,
            Plot: details.description,
            genres: details.genres,
            platforms: details.platforms,
            developers: details.developers,
            publishers: details.publishers,
            gameSeries: details.gameSeries ?? '',
            rating: this.toNumberOrZero(details.rating),
            userRating: 0,
            released: details.released,
            Year: this.toIntegerOrZero(details.year),
            url: details.url,
            status: 'planned',
            main: hltb?.main ?? '',
            main_plus_sides: hltb?.main_plus_sides ?? '',
            perfectionist: hltb?.perfectionist ?? '',
            completionist: hltb?.perfectionist ?? '',
            integrationProvider: source?.provider ?? '',
            integrationId: source?.id ?? '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };
    }

    private buildAnimeValues(details: AnimeDetails, source?: {
        parts?: IntegrationAnimePart[];
        activePartId?: string | null;
        status?: AnimeItem['status'];
        provider?: ProviderId;
        id?: string;
    }): Record<string, unknown> {
        const parts = source && Object.prototype.hasOwnProperty.call(source, 'parts')
            ? source.parts ?? []
            : this.getAnimeParts(details);
        const activePart = parts.find((part) => part.id === source?.activePartId) ?? parts[0] ?? null;
        return {
            name: details.name,
            image: details.image,
            ImageHorizontal: details.imageHorizontal ?? details.image,
            Plot: details.description,
            imdbRating: this.toNumberOrZero(details.imdbRating),
            tags: details.tags,
            Year: this.toIntegerOrZero(details.year),
            studios: details.studios,
            url: details.url,
            status: source?.status ?? 'planned',
            format: details.format || '',
            seasonCurrent: activePart?.seasonNumber ?? 0,
            episodeCurrent: activePart?.episodeCurrent ?? 0,
            episodeTotal: activePart?.episodeTotal ?? 0,
            activePartId: activePart?.id ?? '',
            animePartsYaml: renderPartsYaml(parts),
            rating: 0,
            integrationProvider: source?.provider ?? '',
            integrationId: source?.id ?? '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };
    }

    private buildVideoValues(details: VideoDetails, source?: {
        provider?: ProviderId;
        id?: string;
        activePartId?: string | null;
        status?: IntegrationVideoPart['status'];
    }): Record<string, unknown> {
        const parts = details.parts ?? [];
        const activePart = (source?.activePartId ? parts.find((part) => part.id === source.activePartId) : null) ?? parts[0] ?? null;
        const directors = this.normalizeDisplayList(details.director);
        const actors = this.normalizeDisplayList(details.actors);
        return {
            name: details.name,
            Poster: details.poster,
            PosterHorizontal: details.posterHorizontal || details.poster,
            Plot: details.description,
            genres: details.genres,
            Year: this.toIntegerOrZero(details.year),
            released: this.normalizeDateValue(details.released),
            runtime: this.toIntegerOrZero(details.runtime),
            director: directors,
            directors,
            actors,
            seasons: this.toIntegerOrZero(details.seasons),
            episodeCurrent: activePart?.episodeCurrent ?? details.episodeCurrent ?? 0,
            episodeTotal: activePart?.episodeTotal ?? this.toIntegerOrZero(details.episodeTotal),
            networks: details.networks ?? [],
            rating: this.toNumberOrZero(details.rating),
            url: details.url,
            status: source?.status ?? 'planned',
            activePartId: activePart?.id ?? '',
            videoPartsYaml: renderPartsYaml(parts, true),
            integrationProvider: source?.provider ?? '',
            integrationId: source?.id ?? '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };
    }

    private buildBookValues(details: BookDetails, source?: {
        provider?: ProviderId;
        id?: string;
        title?: string;
        year?: string;
        poster?: string;
    }): Record<string, unknown> {
        const preferSearchResult = source?.provider === 'hardcover';
        const poster = (preferSearchResult ? source?.poster : '') || details.poster || source?.poster || '';
        const title = (preferSearchResult ? source?.title : '') || details.name;
        const year = (preferSearchResult ? source?.year : '') || details.year;
        return {
            name: title,
            Poster: poster,
            PosterHorizontal: details.posterHorizontal || poster,
            Plot: details.description,
            authors: details.authors,
            publisher: this.normalizeDisplayList(details.publisher),
            genres: details.genres,
            Year: this.toIntegerOrZero(year),
            released: this.normalizeDateValue(details.released),
            pageCurrent: 0,
            pageTotal: this.toIntegerOrZero(details.pages),
            chapterCurrent: 0,
            chapterTotal: 0,
            rating: this.toNumberOrZero(details.rating),
            url: details.url,
            bookSeries: details.bookSeries ?? '',
            seriesPosition: details.seriesPosition ?? null,
            status: 'planned',
            integrationProvider: source?.provider ?? '',
            integrationId: source?.id ?? '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };
    }

    private buildMangaValues(details: MangaDetails, source?: {
        provider?: ProviderId;
        id?: string;
        activePartId?: string | null;
        status?: IntegrationMangaPart['status'];
    }): Record<string, unknown> {
        const parts = details.parts ?? [];
        const activePart = (source?.activePartId ? parts.find((part) => part.id === source.activePartId) : null) ?? parts[0] ?? null;
        return {
            name: details.name,
            Poster: details.poster,
            PosterHorizontal: details.posterHorizontal || details.poster,
            Plot: details.description,
            authors: details.authors,
            artists: details.artists,
            genres: details.genres,
            Year: this.toIntegerOrZero(details.year),
            chapterCurrent: activePart?.chapterCurrent ?? 0,
            chapterTotal: activePart?.chapterTotal ?? this.toIntegerOrZero(details.chapters),
            volumeCurrent: activePart?.volumeNumber ?? 0,
            volumeTotal: this.toIntegerOrZero(details.volumes ?? (parts.length ? String(parts.length) : '')),
            rating: this.toNumberOrZero(details.rating),
            url: details.url,
            status: source?.status ?? 'planned',
            activePartId: activePart?.id ?? '',
            mangaPartsYaml: renderMangaPartsYaml(parts),
            integrationProvider: source?.provider ?? '',
            integrationId: source?.id ?? '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };
    }

    private buildManualValues(draft: ManualCreateDraft): Record<string, unknown> {
        const poster = draft.poster || '';
        const posterHorizontal = draft.posterHorizontal || poster;
        const common: Record<string, unknown> = {
            name: draft.title,
            Poster: poster,
            PosterHorizontal: posterHorizontal,
            image: poster,
            ImageHorizontal: posterHorizontal,
            Plot: '',
            genres: draft.genres,
            tags: draft.tags,
            Year: this.toIntegerOrZero(draft.year),
            released: draft.released,
            rating: this.toNumberOrZero(draft.rating),
            userRating: this.toNumberOrZero(draft.rating),
            url: draft.url,
            status: draft.status,
            integrationProvider: '',
            integrationId: '',
            communityRating: '',
            communityVotes: '',
            communityRatingProvider: '',
        };

        if (draft.kind === 'games') {
            return {
                ...common,
                gameSeries: draft.gameSeries,
                platforms: [],
                developers: [],
                publishers: [],
                main: '',
                main_plus_sides: '',
                perfectionist: '',
                completionist: '',
            };
        }

        if (draft.kind === 'anime') {
            const parts = draft.animeParts.length ? draft.animeParts : [{
                id: 'tv-1',
                kind: draft.format,
                title: draft.format === 'tv' ? `Season ${draft.seasonNumber ?? 1}` : draft.format.toUpperCase(),
                seasonNumber: draft.format === 'tv' ? draft.seasonNumber ?? 1 : draft.seasonNumber,
                episodeCurrent: draft.episodeCurrent,
                episodeTotal: draft.episodeTotal,
                status: draft.status,
            }];
            const activePart = parts.find((part) => part.id === draft.activeAnimePartId) ?? parts[0] ?? null;
            return {
                ...common,
                imdbRating: 0,
                studios: [],
                format: activePart?.kind ?? draft.format,
                seasonCurrent: activePart?.seasonNumber ?? 0,
                episodeCurrent: activePart?.episodeCurrent ?? 0,
                episodeTotal: activePart?.episodeTotal ?? 0,
                activePartId: activePart?.id ?? '',
                animePartsYaml: renderPartsYaml(parts),
            };
        }

        if (draft.kind === 'movies' || draft.kind === 'tv') {
            const isSeries = draft.kind === 'tv';
            const seasonNumber = isSeries ? draft.seasonNumber ?? 1 : null;
            const part = {
                id: isSeries ? `season-${seasonNumber ?? 1}` : 'movie-1',
                kind: isSeries ? 'season' : 'movie',
                title: isSeries ? `Season ${seasonNumber ?? 1}` : 'Movie',
                seasonNumber,
                episodeCurrent: draft.episodeCurrent,
                episodeTotal: draft.episodeTotal,
                status: draft.status,
            };
            return {
                ...common,
                released: this.normalizeDateValue(draft.released),
                runtime: 0,
                director: [],
                directors: [],
                actors: [],
                seasons: isSeries ? seasonNumber ?? 0 : 0,
                episodeCurrent: draft.episodeCurrent ?? 0,
                episodeTotal: draft.episodeTotal ?? 0,
                networks: [],
                activePartId: part.id,
                videoPartsYaml: renderPartsYaml([part], true),
            };
        }

        if (draft.kind === 'books') {
            return {
                ...common,
                authors: [],
                publisher: '',
                bookSeries: draft.bookSeries ?? '',
                pageCurrent: draft.pageCurrent ?? 0,
                pageTotal: draft.pageTotal ?? 0,
                chapterCurrent: draft.chapterCurrent ?? 0,
                chapterTotal: draft.chapterTotal ?? 0,
            };
        }

        const volumeNumber = draft.volumeCurrent ?? 1;
        const part = {
            id: `volume-${volumeNumber}`,
            kind: 'volume',
            title: `Volume ${volumeNumber}`,
            volumeNumber,
            chapterCurrent: draft.chapterCurrent,
            chapterTotal: draft.chapterTotal,
            status: draft.status,
        };
        return {
            ...common,
            authors: [],
            artists: [],
            chapterCurrent: draft.chapterCurrent ?? 0,
            chapterTotal: draft.chapterTotal ?? 0,
            volumeCurrent: draft.volumeCurrent ?? 0,
            volumeTotal: draft.volumeTotal ?? 0,
            activePartId: part.id,
            mangaPartsYaml: renderMangaPartsYaml([part]),
        };
    }

    private async prepareManualDraft(draft: ManualCreateDraft, settings: LorebaseSettings): Promise<ManualCreateDraft> {
        if (!draft.posterFile) return draft;
        const folderPath = settings.integrations?.imageStorage?.folderPath || 'files/lorebase/images';
        const localPath = await saveManualImageFileToVault(this.app, draft.posterFile, {
            baseFolder: folderPath,
            kind: draft.kind,
            title: draft.title || 'Untitled',
            label: 'Poster',
        });
        return {
            ...draft,
            poster: localPath,
            posterHorizontal: localPath,
            posterFile: null,
        };
    }

    private async reviewAnimeParts(details: AnimeDetails, options: {
        provider: ProviderId;
        id: string;
        title: string;
        existingParts?: AnimeItem['parts'];
        activePartId?: string | null;
        status?: AnimeItem['status'];
        markNewParts?: boolean;
    }): Promise<{
        parts: IntegrationAnimePart[];
        activePartId: string | null;
        status: AnimeItem['status'];
    } | null> {
        const modal = new AnimePartsReviewModal(this.app, {
            title: t('animePartsProviderTitle'),
            subtitle: options.title,
            providerParts: this.getAnimeParts(details),
            existingParts: options.existingParts,
            activePartId: options.activePartId,
            status: options.status,
            markNewParts: options.markNewParts,
        });
        return modal.openAndGetValue();
    }

    private detailsFromAnime(anime: AnimeItem): AnimeDetails {
        return {
            kind: 'anime',
            name: anime.displayName,
            description: anime.summary ?? anime.description ?? '',
            image: anime.imageUrl,
            imageHorizontal: anime.horizontalImageUrl ?? anime.imageUrl,
            tags: anime.tags,
            studios: [],
            year: anime.year ? String(anime.year) : '',
            imdbRating: '',
            url: anime.sourceUrl ?? '',
            format: anime.format,
            parts: [],
        };
    }

    private getAnimeParts(details: AnimeDetails): IntegrationAnimePart[] {
        if (details.parts?.length) return details.parts;
        return [{
            id: 'main',
            kind: this.normalizeAnimePartKind(details.format),
            title: details.format || details.name || 'Main',
            seasonNumber: this.normalizeAnimePartKind(details.format) === 'tv' ? 1 : null,
            episodeCurrent: 0,
            episodeTotal: null,
            status: 'planned',
        }];
    }

    private normalizeAnimePartKind(format: string | undefined): IntegrationAnimePart['kind'] {
        const value = (format ?? '').trim().toLowerCase();
        if (value === 'movie' || value === 'фильм') return 'movie';
        if (value === 'ova') return 'ova';
        if (value === 'ona') return 'ona';
        if (value === 'special' || value === 'спешл') return 'special';
        return 'tv';
    }

    private toStringSafe(value: unknown): string {
        if (value === null || value === undefined) return '';
        return String(value);
    }

    private toNumberOrZero(value: unknown): number {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (value === null || value === undefined) return 0;
        const parsed = Number.parseFloat(String(value).trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private toIntegerOrZero(value: unknown): number {
        return Math.trunc(this.toNumberOrZero(value));
    }

    private normalizeDateValue(value: unknown): string {
        const text = this.toStringSafe(value).trim();
        if (!text || /^\d{4}$/.test(text)) return '';
        const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (isoMatch) {
            const year = Number(isoMatch[1]);
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            const date = new Date(Date.UTC(year, month - 1, day));
            return date.getUTCFullYear() === year
                && date.getUTCMonth() === month - 1
                && date.getUTCDate() === day
                ? text
                : '';
        }
        const parsed = Date.parse(text);
        if (Number.isNaN(parsed)) return '';
        const date = new Date(parsed);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private normalizeDisplayList(value: unknown): string[] {
        const source = Array.isArray(value) ? value : this.toStringSafe(value).split(/[,;\n]+/);
        const result: string[] = [];
        const seen = new Set<string>();
        for (const entry of source) {
            const text = this.toStringSafe(entry).trim();
            const key = text.toLocaleLowerCase();
            if (!text || seen.has(key)) continue;
            seen.add(key);
            result.push(text);
        }
        return result;
    }

    private firstStringValue(values: Record<string, unknown>, key: string, ...fallbacks: unknown[]): string {
        const primary = this.toStringSafe(values[key]);
        if (primary) return primary;
        for (const fallback of fallbacks) {
            const text = this.toStringSafe(fallback);
            if (text) return text;
        }
        return '';
    }

    private needsFrontmatterFallback(kind: MediaKind, content: string): boolean {
        if (kind !== 'movies' && kind !== 'tv' && kind !== 'books' && kind !== 'manga') return false;
        return !this.hasFrontmatter(content);
    }

    private hasFrontmatter(content: string): boolean {
        for (let index = 0; index < content.length; index++) {
            const char = content[index];
            if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;
            return content[index] === '-' && content[index + 1] === '-' && content[index + 2] === '-';
        }
        return false;
    }

}
