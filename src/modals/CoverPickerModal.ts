/**
 * LOREBASE - Cover Picker Modal
 * Presents a grid of cover images from Apple Books for the user to choose from.
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import { t, type TranslationKey } from '../localization';
import { isRateLimitError } from '../services/integrations/shared';
import type { AppleBooksCoverResult } from '../services/integrations/providers/appleBooks';

/** Number of covers shown per page in the grid. */
const PAGE_SIZE = 3;

/** Callback to re-search Apple Books with a custom query. */
export type CoverSearchFn = (query: string) => Promise<AppleBooksCoverResult[]>;

/** The notice for a failed Apple Books search: rate limits get their own message. */
export function coverSearchErrorKey(error: unknown): TranslationKey {
    return isRateLimitError(error) ? 'coverPickerRateLimited' : 'coverPickerFailed';
}

export class CoverPickerModal extends Modal {
    private results: AppleBooksCoverResult[];
    private hardcoverFallback: string | null;
    private searchFn: CoverSearchFn | null;
    private searchQuery: string;
    private resolve?: (url: string | null) => void;
    private hasResolved = false;
    private visibleCount: number;
    private searching = false;

    constructor(
        app: App,
        results: AppleBooksCoverResult[],
        hardcoverFallback: string | null,
        searchFn?: CoverSearchFn,
        initialQuery?: string
    ) {
        super(app);
        this.results = results;
        this.hardcoverFallback = hardcoverFallback;
        this.searchFn = searchFn ?? null;
        this.searchQuery = initialQuery ?? '';
        this.visibleCount = PAGE_SIZE;
    }

    openAndGetValue(): Promise<string | null> {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.open();
        });
    }

    onOpen(): void {
        this.modalEl.addClass('lorebase-cover-picker-container');
        this.modalEl.querySelector('.modal-close-button, .modal-header-button')?.remove();
        setTimeout(() => {
            this.modalEl.querySelector('.modal-close-button, .modal-header-button')?.remove();
        }, 0);
        this.render();
    }

    onClose(): void {
        this.modalEl.removeClass('lorebase-cover-picker-container');
        if (!this.hasResolved) {
            this.resolve?.(null);
        }
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('lorebase-cover-picker');

        // Header
        const header = contentEl.createDiv({ cls: 'lorebase-cover-picker-header' });
        const titleRow = header.createDiv({ cls: 'lorebase-cover-picker-title-row' });
        const titleIcon = titleRow.createSpan({ cls: 'lorebase-cover-picker-title-icon' });
        setIcon(titleIcon, 'image');
        titleRow.createEl('h2', { cls: 'lorebase-cover-picker-title', text: t('coverPickerTitle') });

        // Search bar
        if (this.searchFn) {
            const searchRow = contentEl.createDiv({ cls: 'lorebase-cover-picker-search' });
            const input = searchRow.createEl('input', {
                cls: 'lorebase-cover-picker-search-input',
                attr: { type: 'text', placeholder: t('coverPickerSearchPlaceholder'), value: this.searchQuery },
            });
            const searchBtn = searchRow.createEl('button', {
                cls: 'lorebase-cover-picker-search-btn',
                attr: { type: 'button', 'aria-label': t('coverPickerSearch') },
            });
            setIcon(searchBtn, 'search');

            const doSearch = async (): Promise<void> => {
                const query = input.value.trim();
                if (!query || this.searching || !this.searchFn) return;
                this.searching = true;
                searchBtn.addClass('is-loading');
                searchBtn.disabled = true;
                try {
                    this.results = await this.searchFn(query);
                    this.searchQuery = query;
                    this.visibleCount = PAGE_SIZE;
                    this.render();
                } catch (error) {
                    console.warn('[LOREBASE] Apple Books cover search failed:', error);
                    new Notice(t(coverSearchErrorKey(error)));
                } finally {
                    this.searching = false;
                    // A successful search re-renders; a failed one must re-enable this button.
                    searchBtn.removeClass('is-loading');
                    searchBtn.disabled = false;
                }
            };

            searchBtn.addEventListener('click', () => void doSearch());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void doSearch();
                }
            });
        }

        // Grid
        const grid = contentEl.createDiv({ cls: 'lorebase-cover-picker-grid' });

        // "Keep Current" card (if Hardcover fallback exists)
        if (this.hardcoverFallback) {
            this.renderCard(grid, {
                imageUrl: this.hardcoverFallback,
                title: t('coverPickerKeepCurrent'),
                subtitle: '',
                source: 'Hardcover',
                highResUrl: this.hardcoverFallback,
                onSelect: () => this.select(null),
                isKeepCurrent: true,
            });
        }

        // Apple Books cover cards
        const visible = this.results.slice(0, this.visibleCount);
        for (const result of visible) {
            this.renderCard(grid, {
                imageUrl: result.thumbnailUrl,
                title: result.trackName,
                subtitle: result.artistName,
                source: 'Apple Books',
                highResUrl: result.coverUrl,
                onSelect: () => this.select(result.coverUrl),
            });
        }

        // No results message
        if (!this.results.length && !this.hardcoverFallback) {
            grid.createDiv({ cls: 'lorebase-cover-picker-empty', text: t('coverPickerNoResults') });
        }

        // "Show More" button
        if (this.visibleCount < this.results.length) {
            const moreBtn = contentEl.createEl('button', {
                cls: 'lorebase-cover-picker-more',
                text: t('coverPickerShowMore'),
                attr: { type: 'button' },
            });
            moreBtn.addEventListener('click', () => {
                this.visibleCount += PAGE_SIZE;
                this.render();
            });
        }

        // Footer with skip button
        const footer = contentEl.createDiv({ cls: 'lorebase-cover-picker-footer' });
        const skipBtn = footer.createEl('button', {
            cls: 'lorebase-cover-picker-skip',
            attr: { type: 'button' },
        });
        const skipIcon = skipBtn.createSpan({ cls: 'lorebase-cover-picker-skip-icon' });
        setIcon(skipIcon, 'x');
        skipBtn.createSpan({ text: t('commonCancel') });
        skipBtn.addEventListener('click', () => {
            this.hasResolved = true;
            this.resolve?.(null);
            this.close();
        });
    }

    private renderCard(
        container: HTMLElement,
        opts: {
            imageUrl: string;
            title: string;
            subtitle: string;
            source: string;
            highResUrl?: string;
            onSelect: () => void;
            isKeepCurrent?: boolean;
        }
    ): void {
        const card = container.createDiv({ cls: 'lorebase-cover-picker-card' });
        if (opts.isKeepCurrent) card.addClass('is-keep-current');

        const imageEl = card.createDiv({ cls: 'lorebase-cover-picker-image' });
        if (opts.imageUrl) {
            const img = new Image();
            img.onload = () => {
                imageEl.setCssStyles({ backgroundImage: `url("${opts.imageUrl}")` });
            };
            img.onerror = () => {
                imageEl.addClass('is-empty');
            };
            img.src = opts.imageUrl;
        } else {
            imageEl.addClass('is-empty');
        }

        const label = card.createDiv({ cls: 'lorebase-cover-picker-label' });
        label.createDiv({ cls: 'lorebase-cover-picker-label-title', text: opts.title });
        if (opts.subtitle) {
            label.createDiv({ cls: 'lorebase-cover-picker-label-subtitle', text: opts.subtitle });
        }

        const meta = card.createDiv({ cls: 'lorebase-cover-picker-label-meta' });
        meta.createSpan({ text: opts.source });
        if (opts.highResUrl) {
            const resSpan = meta.createSpan({ cls: 'lorebase-cover-picker-resolution' });
            const probe = new Image();
            probe.onload = () => {
                resSpan.setText(`${probe.naturalWidth}×${probe.naturalHeight}`);
            };
            probe.src = opts.highResUrl;
        }

        card.addEventListener('click', opts.onSelect);
    }

    private select(url: string | null): void {
        this.hasResolved = true;
        this.resolve?.(url);
        this.close();
    }
}
