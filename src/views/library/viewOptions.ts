import { FieldDefinition, MediaItem, MediaStatus, MediaType, SortField, StatusLabelSettings } from '../../types';
import { i18n, t } from '../../localization';

export function getStatusOptionsForMediaType(
    mediaType: MediaType,
    statusLabels?: StatusLabelSettings
): Array<{ status: MediaStatus; label: string }> {
    const labelFor = (status: MediaStatus, fallback: string): string => {
        const labels = mediaType === 'anime'
            ? statusLabels?.anime
            : mediaType === 'movie'
                ? statusLabels?.movies
                : mediaType === 'tv'
                    ? statusLabels?.tv
                    : mediaType === 'book'
                        ? statusLabels?.books
                        : mediaType === 'manga'
                            ? statusLabels?.manga
                            : statusLabels?.games;
        const labelMap: Partial<Record<MediaStatus, string>> | undefined = labels;
        return labelMap?.[status]?.trim() || fallback;
    };
    if (mediaType === 'anime' || mediaType === 'movie' || mediaType === 'tv' || mediaType === 'book' || mediaType === 'manga') {
        const plannedLabel = mediaType === 'book' || mediaType === 'manga' ? t('statusPlanToRead') : t('statusPlanned');
        const activeLabel = mediaType === 'book' || mediaType === 'manga' ? t('statusReading') : t('statusWatching');
        const completedLabel = mediaType === 'book' || mediaType === 'manga' ? t('statusReadCompleted') : t('statusCompleted');
        return [
            { status: 'planned', label: labelFor('planned', plannedLabel) },
            { status: 'watching', label: labelFor('watching', activeLabel) },
            { status: 'completed', label: labelFor('completed', completedLabel) },
            { status: 'dropped', label: labelFor('dropped', t('statusDropped')) },
            { status: 'paused', label: labelFor('paused', t('statusPaused')) },
        ];
    }

    return [
        { status: 'planned', label: labelFor('planned', t('statusPlanned')) },
        { status: 'playing', label: labelFor('playing', t('statusPlaying')) },
        { status: 'completed', label: labelFor('completed', t('statusPlayed')) },
        { status: 'dropped', label: labelFor('dropped', t('statusDropped')) },
        { status: 'paused', label: labelFor('paused', t('statusPaused')) },
        { status: 'sandbox', label: labelFor('sandbox', t('statusSandbox')) },
    ];
}

export function getSortOptionsForMediaType(mediaType: MediaType): Array<{ field: SortField; label: string }> {
    if (mediaType === 'anime' || mediaType === 'movie' || mediaType === 'tv' || mediaType === 'book' || mediaType === 'manga') {
        const dateLabel = mediaType === 'book' || mediaType === 'manga'
            ? t('sortDateRead')
            : t('sortDateWatched');
        return [
            { field: 'name', label: t('sortName') },
            { field: 'rating', label: t('sortRating') },
            { field: 'year', label: t('sortYear') },
            { field: 'dateStarted', label: dateSortLabel(true) },
            { field: 'dateFinished', label: dateLabel },
        ];
    }

    return [
        { field: 'series', label: t('sortSeries') },
        { field: 'name', label: t('sortName') },
        { field: 'rating', label: t('sortRating') },
        { field: 'year', label: t('sortYear') },
        { field: 'dateStarted', label: dateSortLabel(true) },
        { field: 'dateFinished', label: t('sortDateCompleted') },
    ];
}

export function getBuiltInFieldDefinitions(
    mediaType: MediaType,
    statuses: Array<{ status: MediaStatus; label: string }>,
    flags: { showCustom: boolean }
): FieldDefinition[] {
    const language = i18n.getLanguage();
    const startedLabel = language === 'ru' ? 'Дата начала' : language === 'uk' ? 'Дата початку' : 'Start date';
    const finishedLabel = language === 'ru' ? 'Дата окончания' : language === 'uk' ? 'Дата завершення' : 'Finish date';
    const definitions: FieldDefinition[] = [
        {
            id: 'status', label: t('status'), icon: 'circle-dot', type: 'list', source: 'builtin',
            operators: ['containsAny', 'notContains'],
            options: statuses.map((entry) => ({ value: entry.status, label: entry.label })),
        },
        {
            id: 'favorite', label: t('statusFavorite'), icon: 'heart', type: 'boolean', source: 'builtin',
            operators: ['isTrue', 'isFalse'],
        },
        {
            id: 'year', label: t('year'), icon: 'calendar-days', type: 'number', source: 'builtin',
            operators: ['equals', 'greater', 'less', 'between', 'empty', 'notEmpty'],
        },
        {
            id: 'rating', label: t('editRating'), icon: 'star', type: 'number', source: 'builtin',
            operators: ['equals', 'greater', 'less', 'between', 'empty', 'notEmpty'],
        },
        {
            id: 'dateStarted', label: startedLabel, icon: 'calendar-clock', type: 'date', source: 'builtin',
            operators: ['thisMonth', 'thisYear', 'between', 'equals', 'greater', 'less', 'empty', 'notEmpty'],
        },
        {
            id: 'dateFinished', label: finishedLabel, icon: 'calendar-check', type: 'date', source: 'builtin',
            operators: ['thisMonth', 'thisYear', 'between', 'equals', 'greater', 'less', 'empty', 'notEmpty'],
        },
    ];
    if (mediaType === 'game') {
        definitions.splice(1, 0, {
            id: 'series', label: t('sortSeries'), icon: 'layers', type: 'text', source: 'builtin',
            operators: ['contains', 'equals', 'notEquals', 'empty', 'notEmpty'],
        });
    }
    if (flags.showCustom) {
        definitions.push({
            id: 'custom', label: t('modeCustom'), icon: 'image', type: 'boolean', source: 'builtin',
            operators: ['isTrue', 'isFalse'],
        });
    }
    return definitions;
}

function dateSortLabel(started: boolean): string {
    const language = i18n.getLanguage();
    if (language === 'ru') return started ? 'Дата начала' : 'Дата окончания';
    if (language === 'uk') return started ? 'Дата початку' : 'Дата завершення';
    return started ? 'Date started' : 'Date finished';
}

export function getFilterFlagsForMediaType(mediaType: MediaType): { showCustom: boolean } {
    if (mediaType === 'anime') {
        return { showCustom: false };
    }
    if (mediaType === 'manga') {
        return { showCustom: false };
    }
    if (mediaType === 'movie' || mediaType === 'tv' || mediaType === 'book') {
        return { showCustom: false };
    }
    return { showCustom: true };
}

export function getRandomLabelForMediaType(mediaType: MediaType): string {
    if (mediaType === 'anime') return t('randomAnime');
    if (mediaType === 'movie') return t('settingsMovies');
    if (mediaType === 'tv') return t('settingsTv');
    if (mediaType === 'book') return t('randomBook');
    if (mediaType === 'manga') return t('randomManga');
    return t('random');
}

export function getRandomTitleLabelForMediaType(mediaType: MediaType): string {
    if (mediaType === 'anime') return t('randomAnime');
    if (mediaType === 'movie') return t('settingsMovies');
    if (mediaType === 'tv') return t('settingsTv');
    if (mediaType === 'book') return t('randomBook');
    if (mediaType === 'manga') return t('randomManga');
    return t('randomGame');
}

type TagSummary = {
    id: string;
    label: string;
    count: number;
};

export function collectToolbarTags(
    items: MediaItem[],
    selected: { tags: string[]; genres: string[] }
): { planTags?: TagSummary[]; tags: TagSummary[]; genres: TagSummary[] } {
    const tagCounts = new Map<string, number>();
    const genreCounts = new Map<string, number>();

    for (const item of items) {
        if (item?.tags) {
            for (const tag of item.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
        }
        if (item?.genres) {
            for (const genre of item.genres) {
                genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
            }
        }
    }

    const buildTagList = (counts: Map<string, number>, selectedValues: string[]): TagSummary[] => {
        const items = Array.from(counts.entries())
            .map(([tag, count]) => ({ id: tag, label: tag, count }))
            .sort((a, b) => a.label.localeCompare(b.label));

        for (const tag of selectedValues) {
            if (!counts.has(tag)) {
                items.push({ id: tag, label: tag, count: 0 });
            }
        }

        return items.sort((a, b) => a.label.localeCompare(b.label));
    };

    return {
        tags: buildTagList(tagCounts, selected.tags),
        genres: buildTagList(genreCounts, selected.genres),
    };
}
