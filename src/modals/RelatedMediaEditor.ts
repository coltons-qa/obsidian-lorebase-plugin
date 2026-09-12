import { App, Modal } from 'obsidian';
import { DEFAULT_COVER } from '../constants';
import { t } from '../localization';
import type { RelatedMediaLink } from '../types';

/** Callback for clicking a related media card. Mirrors the library card click convention. */
export type RelatedItemClickHandler = (item: RelatedMediaLink, event: MouseEvent) => void;

export class RelatedMediaEditor {
    private values: RelatedMediaLink[];
    private candidates: RelatedMediaLink[];
    private incoming: RelatedMediaLink[];
    private draggedPath: string | null = null;
    private onItemClick?: RelatedItemClickHandler;

    constructor(
        private app: App,
        currentPath: string,
        values: RelatedMediaLink[] = [],
        candidates: RelatedMediaLink[] = [],
        incoming: RelatedMediaLink[] = [],
        onItemClick?: RelatedItemClickHandler
    ) {
        this.onItemClick = onItemClick;
        this.values = normalizeRelatedMedia(values);
        this.candidates = normalizeRelatedMedia(candidates)
            .filter((candidate) => candidate.path !== currentPath);
        this.incoming = normalizeRelatedMedia(incoming)
            .filter((candidate) => candidate.path !== currentPath);

        // Reconcile stored types: entries saved before the resolveMediaType fix
        // may carry the wrong type (e.g. 'game' for a book in a shared folder).
        // The candidates list is rebuilt fresh each time with the correct type from
        // frontmatter, so use it as the source of truth. This also means the next
        // save writes the corrected type back to the note.
        reconcileRelatedTypes(this.values, this.candidates);
        reconcileRelatedTypes(this.incoming, this.candidates);
    }

    bind(root: HTMLElement): void {
        root.querySelector<HTMLButtonElement>('[data-action="add-related"]')
            ?.addEventListener('click', () => {
                const selected = new Set(this.values.map((item) => item.path));
                const candidates = this.candidates.filter((candidate) => !selected.has(candidate.path));
                new RelatedMediaPickerModal(this.app, candidates, (picked) => {
                    this.values = normalizeRelatedMedia([...this.values, ...picked]);
                    this.render(root);
                }).open();
            });
        this.render(root);
    }

    getValue(): RelatedMediaLink[] {
        return this.values.map((item) => ({ ...item }));
    }

    private render(root: HTMLElement): void {
        const container = root.querySelector<HTMLElement>('[data-role="related-media"]');
        if (!container) return;
        container.empty();

        const outgoingPaths = new Set(this.values.map((item) => item.path));
        const incomingOnly = this.incoming.filter((item) => !outgoingPaths.has(item.path));
        const displayItems = [...this.values, ...incomingOnly];
        if (!displayItems.length) {
            container.createDiv({ cls: 'lorebase-editmode-related-empty', text: t('editRelatedEmpty') });
            return;
        }

        for (const item of displayItems) {
            const outgoingIndex = this.values.findIndex((entry) => entry.path === item.path);
            this.renderCard(container, item, outgoingIndex, root);
        }
    }

    private renderCard(
        container: HTMLElement,
        item: RelatedMediaLink,
        outgoingIndex: number,
        root: HTMLElement
    ): void {
        const readonly = outgoingIndex < 0;
        const candidate = this.candidates.find((entry) => entry.path === item.path);
        const imageUrl = item.imageUrl || candidate?.imageUrl || DEFAULT_COVER;
        const row = container.createDiv({
            cls: `lorebase-editmode-related-item${readonly ? ' is-readonly' : ''}`,
            attr: {
                title: item.title || item.path,
                draggable: String(!readonly),
                'data-path': item.path,
            },
        });
        if (!readonly) this.bindDrag(row, item.path, root);
        if (this.onItemClick) {
            row.setCssStyles({ cursor: 'pointer' });
            const handler = this.onItemClick;
            row.addEventListener('click', (event) => {
                // Let button clicks (order/remove) bubble without triggering navigation.
                if ((event.target as HTMLElement | null)?.closest('button')) return;
                handler(item, event);
            });
        }
        const image = row.createDiv({ cls: 'lorebase-editmode-related-image' });
        image.setCssStyles({
            backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`,
            height: '120px',
            minHeight: '120px',
        });
        image.createSpan({ cls: 'lorebase-editmode-related-type', text: getRelatedTypeLabel(item.type) });
        row.createSpan({ cls: 'lorebase-editmode-related-title', text: item.title || item.path });
        if (readonly) return;

        const order = row.createDiv({ cls: 'lorebase-editmode-related-order' });
        const up = order.createEl('button', {
            cls: 'lorebase-editmode-related-order-btn',
            text: '↑',
            attr: { type: 'button', 'aria-label': 'Move up' },
        });
        up.disabled = outgoingIndex === 0;
        up.toggleClass('is-disabled', up.disabled);
        up.addEventListener('click', (event) => {
            event.stopPropagation();
            this.move(outgoingIndex, -1);
            this.render(root);
        });

        const down = order.createEl('button', {
            cls: 'lorebase-editmode-related-order-btn',
            text: '↓',
            attr: { type: 'button', 'aria-label': 'Move down' },
        });
        down.disabled = outgoingIndex === this.values.length - 1;
        down.toggleClass('is-disabled', down.disabled);
        down.addEventListener('click', (event) => {
            event.stopPropagation();
            this.move(outgoingIndex, 1);
            this.render(root);
        });

        const remove = row.createEl('button', {
            cls: 'lorebase-editmode-related-remove',
            text: '×',
            attr: { type: 'button', 'aria-label': t('editRemoveHint') },
        });
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.values = this.values.filter((entry) => entry.path !== item.path);
            this.render(root);
        });
    }

    private bindDrag(card: HTMLElement, targetPath: string, root: HTMLElement): void {
        card.addEventListener('dragstart', (event) => {
            if ((event.target as HTMLElement | null)?.closest('button')) {
                event.preventDefault();
                return;
            }
            this.draggedPath = targetPath;
            card.addClass('is-dragging');
            event.dataTransfer?.setData('text/plain', targetPath);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragover', (event) => {
            if (!this.draggedPath || this.draggedPath === targetPath) return;
            event.preventDefault();
            card.addClass('is-drop-target');
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        card.addEventListener('dragleave', () => {
            card.removeClass('is-drop-target');
        });
        card.addEventListener('drop', (event) => {
            event.preventDefault();
            card.removeClass('is-drop-target');
            const draggedPath = this.draggedPath;
            this.draggedPath = null;
            if (!draggedPath || draggedPath === targetPath) return;
            this.reorder(draggedPath, targetPath);
            this.render(root);
        });
        card.addEventListener('dragend', () => {
            this.draggedPath = null;
            root.querySelectorAll<HTMLElement>('.lorebase-editmode-related-item').forEach((item) => {
                item.removeClass('is-dragging');
                item.removeClass('is-drop-target');
            });
        });
    }

    private reorder(draggedPath: string, targetPath: string): void {
        const next = [...this.values];
        const from = next.findIndex((item) => item.path === draggedPath);
        const to = next.findIndex((item) => item.path === targetPath);
        if (from < 0 || to < 0 || from === to) return;
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        this.values = next;
    }

    private move(index: number, direction: -1 | 1): void {
        const target = index + direction;
        if (index < 0 || target < 0 || target >= this.values.length) return;
        const next = [...this.values];
        [next[index], next[target]] = [next[target], next[index]];
        this.values = next;
    }
}

class RelatedMediaPickerModal extends Modal {
    private query = '';
    private mediaFilter: RelatedMediaLink['type'] = 'anime';
    private listEl: HTMLElement | null = null;
    private footerEl: HTMLElement | null = null;
    private selectedPaths = new Set<string>();
    private selectedOrder: string[] = [];

    constructor(
        app: App,
        private candidates: RelatedMediaLink[],
        private onPick: (candidates: RelatedMediaLink[]) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass('lorebase-related-picker', 'lorebase-modal-panel');
        this.modalEl.addClass('lorebase-related-picker-container');

        const header = this.contentEl.createDiv({ cls: 'lorebase-related-picker-header' });
        header.createEl('h2', { text: t('editRelatedPickerTitle') });
        const search = this.contentEl.createEl('input', {
            cls: 'lorebase-editmode-input lorebase-related-picker-search',
            attr: { type: 'text', placeholder: t('promptSearchPlaceholder') },
        });
        search.addEventListener('input', () => {
            this.query = search.value.trim().toLowerCase();
            this.renderList();
        });

        const filters = this.contentEl.createDiv({ cls: 'lorebase-related-picker-filters' });
        for (const option of getRelatedTypeOptions()) {
            const button = filters.createEl('button', {
                cls: `lorebase-related-picker-filter ${this.mediaFilter === option.value ? 'is-active' : ''}`,
                text: option.label,
                attr: { type: 'button', 'aria-pressed': String(this.mediaFilter === option.value) },
            });
            button.addEventListener('click', () => {
                this.mediaFilter = option.value;
                filters.querySelectorAll<HTMLButtonElement>('.lorebase-related-picker-filter').forEach((entry) => {
                    const active = entry === button;
                    entry.toggleClass('is-active', active);
                    entry.setAttr('aria-pressed', String(active));
                });
                this.renderList();
            });
        }

        this.listEl = this.contentEl.createDiv({ cls: 'lorebase-related-picker-grid' });
        this.footerEl = this.contentEl.createDiv({ cls: 'lorebase-related-picker-footer' });
        this.renderList();
        this.renderFooter();
        search.focus();
    }

    onClose(): void {
        this.contentEl.empty();
        this.modalEl.removeClass('lorebase-related-picker-container');
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        const items = this.candidates
            .filter((candidate) => {
                if (!this.query) return candidate.type === this.mediaFilter;
                return candidate.title.toLowerCase().includes(this.query)
                    || candidate.path.toLowerCase().includes(this.query);
            })
            .slice(0, 80);
        if (!items.length) {
            this.listEl.createDiv({ cls: 'lorebase-editmode-related-empty', text: t('editRelatedEmpty') });
            return;
        }

        for (const item of items) {
            const selected = this.selectedPaths.has(item.path);
            const card = this.listEl.createEl('button', {
                cls: `lorebase-related-picker-card ${selected ? 'is-selected' : ''}`,
                attr: { type: 'button', title: item.path, 'aria-pressed': String(selected) },
            });
            const image = card.createDiv({ cls: 'lorebase-related-picker-card-image' });
            image.setCssStyles({
                backgroundImage: `url("${(item.imageUrl || DEFAULT_COVER).replace(/"/g, '\\"')}")`,
            });
            image.createSpan({ cls: 'lorebase-related-picker-card-type', text: getRelatedTypeLabel(item.type) });
            card.createSpan({ cls: 'lorebase-related-picker-card-check', text: '✓' });
            const body = card.createDiv({ cls: 'lorebase-related-picker-card-body' });
            body.createDiv({ cls: 'lorebase-related-picker-card-title', text: item.title });
            body.createDiv({ cls: 'lorebase-related-picker-card-path', text: item.path });
            card.addEventListener('click', () => {
                this.toggle(item.path);
                this.renderList();
                this.renderFooter();
            });
        }
    }

    private toggle(path: string): void {
        if (this.selectedPaths.has(path)) {
            this.selectedPaths.delete(path);
            this.selectedOrder = this.selectedOrder.filter((entry) => entry !== path);
            return;
        }
        this.selectedPaths.add(path);
        this.selectedOrder.push(path);
    }

    private renderFooter(): void {
        if (!this.footerEl) return;
        this.footerEl.empty();
        const count = this.selectedPaths.size;
        this.footerEl.createSpan({
            cls: 'lorebase-related-picker-selected',
            text: count ? `${t('promptSelectedLabel')}: ${count}` : '',
        });
        const actions = this.footerEl.createDiv({ cls: 'lorebase-related-picker-actions' });
        const cancel = actions.createEl('button', {
            cls: 'lorebase-button lorebase-button-secondary',
            text: t('commonCancel'),
            attr: { type: 'button' },
        });
        cancel.addEventListener('click', () => this.close());
        const add = actions.createEl('button', {
            cls: 'lorebase-button lorebase-button-primary',
            text: count ? `${t('promptAddSelected')} (${count})` : t('promptAddSelected'),
            attr: { type: 'button' },
        });
        add.disabled = count === 0;
        add.toggleClass('is-disabled', add.disabled);
        add.addEventListener('click', () => {
            const picked = this.selectedOrder
                .map((path) => this.candidates.find((candidate) => candidate.path === path))
                .filter((candidate): candidate is RelatedMediaLink => Boolean(candidate));
            if (!picked.length) return;
            this.onPick(picked);
            this.close();
        });
    }
}

function normalizeRelatedMedia(values: RelatedMediaLink[]): RelatedMediaLink[] {
    const unique = new Map<string, RelatedMediaLink>();
    for (const value of values) {
        const path = value.path?.trim();
        if (!path) continue;
        unique.set(path, {
            type: value.type,
            path,
            title: value.title?.trim() || path.split('/').pop()?.replace(/\.md$/i, '') || path,
            imageUrl: value.imageUrl ?? null,
        });
    }
    return Array.from(unique.values());
}

function getRelatedTypeOptions(): Array<{ value: RelatedMediaLink['type']; label: string }> {
    return [
        { value: 'game', label: t('settingsGames') },
        { value: 'anime', label: t('settingsAnime') },
        { value: 'movie', label: t('settingsMovies') },
        { value: 'tv', label: t('settingsTv') },
        { value: 'book', label: t('settingsBooks') },
        { value: 'manga', label: t('settingsManga') },
    ];
}

function getRelatedTypeLabel(type: RelatedMediaLink['type']): string {
    return getRelatedTypeOptions().find((option) => option.value === type)?.label ?? type;
}

/**
 * Correct the `type` on stored related-media entries using the freshly built candidate
 * list as the source of truth. Entries saved before the `resolveMediaType` fix may carry
 * the wrong type (e.g. `game` for a book in a shared folder). Mutates in place so both
 * the display and the next save reflect the corrected type.
 */
export function reconcileRelatedTypes(items: RelatedMediaLink[], candidates: RelatedMediaLink[]): void {
    if (!candidates.length) return;
    const typeByPath = new Map(candidates.map((c) => [c.path, c.type]));
    for (const item of items) {
        const correctType = typeByPath.get(item.path);
        if (correctType && correctType !== item.type) {
            item.type = correctType;
        }
    }
}
