import { setIcon } from 'obsidian';
import { t } from '../localization';
import type { MediaItem } from '../types';

export type MediaSourceAction = () => Promise<boolean | void>;

export function renderMediaSourcePanel(
    root: HTMLElement,
    item: MediaItem,
    onRefresh?: MediaSourceAction,
    onChange?: MediaSourceAction,
    showUrl = true,
    onRefreshCover?: MediaSourceAction
): void {
    if (!onRefresh && !onChange) return;
    const column = root.querySelector<HTMLElement>('.lorebase-editmode-column-right');
    if (!column) return;

    const panel = createDiv({ cls: 'lorebase-editmode-panel lorebase-editmode-panel-glass lorebase-source-panel' });
    panel.dataset.mobilePane = 'more';
    const titleRow = panel.createDiv({ cls: 'lorebase-editmode-panel-title-row' });
    titleRow.createEl('h3', { cls: 'lorebase-editmode-panel-title', text: t('editSource') });
    const compactRow = panel.createDiv({ cls: 'lorebase-source-compact-row' });
    const state = compactRow.createDiv({ cls: 'lorebase-source-state' });
    const actions = compactRow.createDiv({ cls: 'lorebase-source-actions' });
    const urlRow = showUrl ? panel.createDiv({ cls: 'lorebase-source-url-row' }) : null;

    const render = (): void => {
        state.empty();
        actions.empty();
        urlRow?.empty();
        const identity = resolveSourceIdentity(item);
        const provider = identity.provider;
        const id = identity.id;
        const connected = Boolean(provider && id);
        const status = state.createDiv({ cls: 'lorebase-source-status' });
        const icon = status.createSpan({ cls: 'lorebase-source-status-icon' });
        setIcon(icon, connected ? 'link-2' : 'unlink');
        status.createSpan({ text: connected ? t('editSourceConnected') : t('editSourceNotConnected') });
        if (connected) {
            state.createDiv({ cls: 'lorebase-source-identity', text: `${provider.toUpperCase()} · ${id}` });
        }

        if (connected && onRefresh) {
            createAction(actions, 'refresh-cw', t('editSourceRefresh'), onRefresh, render, true);
        }
        if (onChange) {
            createAction(
                actions,
                connected ? 'repeat-2' : 'link-2',
                connected ? t('editSourceChange') : t('editSourceLink'),
                onChange,
                render,
                connected
            );
        }
        if (onRefreshCover) {
            createAction(actions, 'image', t('editRefreshCover'), onRefreshCover, render, true);
        }

        if (urlRow) {
            const sourceUrl = resolveSourceUrl(item, identity);
            urlRow.createSpan({ cls: 'lorebase-source-url-label', text: 'URL' });
            const value = urlRow.createEl('code', {
                cls: `lorebase-source-url-value ${sourceUrl ? '' : 'is-empty'}`,
                text: sourceUrl || '—',
                attr: { title: sourceUrl || t('editUrl') },
            });
            value.toggleClass('is-empty', !sourceUrl);
            const openButton = urlRow.createEl('button', {
                cls: 'lorebase-editmode-btn lorebase-editmode-btn-tight lorebase-source-url-open',
                attr: {
                    type: 'button',
                    title: t('editOpen'),
                    'aria-label': t('editOpen'),
                },
            });
            setIcon(openButton, 'external-link');
            openButton.disabled = !sourceUrl;
            openButton.toggleClass('is-disabled', !sourceUrl);
            openButton.addEventListener('click', () => {
                if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener');
            });
        }
    };

    render();
    const communityRating = column.querySelector<HTMLElement>('.lorebase-editmode-community-rating');
    if (communityRating) {
        communityRating.after(panel);
        return;
    }
    const dates = column.querySelector<HTMLElement>('.lorebase-editmode-timestamps');
    if (dates) dates.before(panel);
    else column.appendChild(panel);
}

function resolveSourceUrl(item: MediaItem, identity = resolveSourceIdentity(item)): string | null {
    const explicit = normalizeUrl(item.sourceUrl ?? '');
    if (explicit) return explicit;

    const id = identity.id;
    if (!id) return null;
    const encodedId = encodeURIComponent(id);
    switch (identity.provider) {
        case 'steam': return `https://store.steampowered.com/app/${encodedId}/`;
        case 'rawg': return `https://rawg.io/games/${encodedId}`;
        case 'anilist': return `https://anilist.co/anime/${encodedId}`;
        case 'jikan': return `https://myanimelist.net/anime/${encodedId}`;
        case 'shikimori': return `https://shikimori.one/animes/${encodedId}`;
        case 'tmdb': return `https://www.themoviedb.org/${item.type === 'tv' ? 'tv' : 'movie'}/${encodedId}`;
        case 'tvmaze': return `https://www.tvmaze.com/shows/${encodedId}`;
        case 'omdb': return `https://www.imdb.com/title/${encodedId}/`;
        case 'googlebooks': return `https://books.google.com/books?id=${encodedId}`;
        case 'mangaupdates': return `https://www.mangaupdates.com/series/${encodedId}`;
        case 'mangadex': return `https://mangadex.org/title/${encodedId}`;
        default: return null;
    }
}

function resolveSourceIdentity(item: MediaItem): { provider: string; id: string } {
    const explicitProvider = item.integrationProvider ? String(item.integrationProvider).trim().toLowerCase() : '';
    const explicitId = item.integrationId ? String(item.integrationId).trim() : '';
    if (explicitProvider && explicitId) return { provider: explicitProvider, id: explicitId };

    const url = item.sourceUrl?.trim() ?? '';
    const patterns: Array<{ provider: string; pattern: RegExp }> = [
        { provider: 'steam', pattern: /store\.steampowered\.com\/app\/(\d+)/i },
        { provider: 'rawg', pattern: /rawg\.io\/games\/([^/?#]+)/i },
        { provider: 'anilist', pattern: /anilist\.co\/(?:anime|manga)\/(\d+)/i },
        { provider: 'jikan', pattern: /myanimelist\.net\/(?:anime|manga)\/(\d+)/i },
        { provider: 'shikimori', pattern: /shikimori\.(?:one|me)\/(?:animes|mangas)\/[^\d]*(\d+)/i },
        { provider: 'tmdb', pattern: /themoviedb\.org\/(?:movie|tv)\/(\d+)/i },
        { provider: 'tvmaze', pattern: /tvmaze\.com\/shows\/(\d+)/i },
        { provider: 'omdb', pattern: /imdb\.com\/title\/(tt\d+)/i },
        { provider: 'googlebooks', pattern: /books\.google\.[^/?#]+\/books\?[^#]*\bid=([^&#]+)/i },
        { provider: 'mangaupdates', pattern: /mangaupdates\.com\/series\/([^/?#]+)/i },
        { provider: 'mangadex', pattern: /mangadex\.org\/title\/([^/?#]+)/i },
    ];
    for (const candidate of patterns) {
        const match = candidate.pattern.exec(url);
        if (match?.[1]) return { provider: candidate.provider, id: decodeURIComponent(match[1]) };
    }

    const steamAppId = item.type === 'game' && 'steamAppId' in item ? String(item.steamAppId ?? '').trim() : '';
    return steamAppId ? { provider: 'steam', id: steamAppId } : { provider: explicitProvider, id: explicitId };
}

function normalizeUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^(https?:\/\/|obsidian:\/\/)/i.test(trimmed)) return trimmed;
    if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return `https://${trimmed}`;
    return null;
}

function createAction(
    container: HTMLElement,
    iconName: string,
    label: string,
    action: MediaSourceAction,
    rerender: () => void,
    iconOnly = false
): void {
    const button = container.createEl('button', {
        cls: `lorebase-editmode-btn lorebase-editmode-btn-tight lorebase-source-action ${iconOnly ? 'is-icon-only' : ''}`,
        attr: { type: 'button', title: label, 'aria-label': label },
    });
    setIcon(button.createSpan({ cls: 'lorebase-source-action-icon' }), iconName);
    if (!iconOnly) button.createSpan({ text: label });
    button.addEventListener('click', () => {
        void (async (): Promise<void> => {
            button.disabled = true;
            button.addClass('is-loading');
            try {
                const changed = await action();
                if (changed !== false) rerender();
            } finally {
                button.disabled = false;
                button.removeClass('is-loading');
            }
        })();
    });
}
