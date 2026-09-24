/**
 * LOREBASE - Series combobox
 *
 * A text input with a dropdown of the library's existing series names, used by the game
 * and book editors. Typing filters the list; opening it always shows every series, so a
 * field that already holds one does not hide the rest. Closes on an outside click or
 * Escape.
 */

import { setIcon } from 'obsidian';
import { t } from '../localization';

export interface SeriesComboboxOptions {
    /** The current series, or '' for none. */
    value: string;
    /** Existing series names to suggest. */
    suggestions: readonly string[];
    /** Called with the trimmed series whenever it changes ('' for none). */
    onChange: (value: string) => void;
}

export function renderSeriesCombobox(host: HTMLElement, options: SeriesComboboxOptions): void {
    let current = options.value.trim();
    const setCurrent = (value: string): void => {
        current = value.trim();
        options.onChange(current);
    };

    host.empty();
    host.addClass('lorebase-settings-dropdown', 'lorebase-editmode-combobox');

    const input = host.createEl('input', {
        cls: 'lorebase-editmode-input lorebase-editmode-combobox-input',
        attr: {
            type: 'text',
            placeholder: t('editSeries'),
            'aria-haspopup': 'listbox',
            'aria-expanded': 'false',
        },
    });
    input.value = current;

    const toggle = host.createEl('button', {
        cls: 'lorebase-editmode-combobox-toggle',
        attr: { type: 'button', 'aria-label': t('editSeries') },
    });
    setIcon(toggle, 'chevron-down');

    const panel = host.createDiv({
        cls: 'lorebase-settings-dropdown-panel lorebase-editmode-combobox-panel',
        attr: { role: 'listbox' },
    });

    const uniqueSeries = Array.from(new Set(
        options.suggestions
            .map((series) => series.trim())
            .filter((series) => series.length > 0)
    ));

    const close = (): void => {
        panel.removeClass('is-open');
        toggle.removeClass('is-open');
        input.setAttribute('aria-expanded', 'false');
    };

    const open = (): void => {
        panel.addClass('is-open');
        toggle.addClass('is-open');
        input.setAttribute('aria-expanded', 'true');
    };

    const selectValue = (value: string): void => {
        setCurrent(value);
        input.value = current;
        close();
    };

    const addOption = (label: string, value: string): void => {
        const selected = value === current;
        const option = panel.createDiv({
            cls: 'lorebase-settings-dropdown-option',
            attr: { role: 'option', tabindex: '0', 'aria-selected': String(selected) },
        });
        option.toggleClass('is-selected', selected);
        option.createSpan({ cls: 'lorebase-settings-dropdown-option-label', text: label });
        if (selected) {
            const check = option.createSpan({ cls: 'lorebase-settings-dropdown-option-check' });
            setIcon(check, 'check');
        }
        option.addEventListener('click', () => selectValue(value));
        option.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            selectValue(value);
        });
    };

    // Only filter while the user is actively typing. Opening the panel always lists
    // everything, otherwise a field that already holds a series filters the list down
    // to that one entry and the rest of the library looks missing.
    const renderOptions = (query = ''): void => {
        panel.empty();
        addOption(t('editNoSeries'), '');
        const values = query
            ? uniqueSeries.filter((series) => series.toLowerCase().includes(query))
            : uniqueSeries;
        for (const value of values) addOption(value, value);
    };

    input.addEventListener('input', () => {
        setCurrent(input.value);
        renderOptions(current.toLowerCase());
        open();
    });
    input.addEventListener('focus', () => {
        renderOptions();
        open();
    });
    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        renderOptions();
        if (panel.hasClass('is-open')) close();
        else open();
    });

    // Document-level listeners, removed once the editor is gone.
    const ownerDocument = host.ownerDocument;
    const detachIfGone = (): boolean => {
        if (host.isConnected) return false;
        ownerDocument.removeEventListener('click', onDocumentClick);
        ownerDocument.removeEventListener('keydown', onKeydown);
        return true;
    };
    const onDocumentClick = (event: MouseEvent): void => {
        if (detachIfGone()) return;
        if (!host.contains(event.target as Node)) close();
    };
    const onKeydown = (event: KeyboardEvent): void => {
        if (detachIfGone()) return;
        if (event.key === 'Escape') close();
    };
    ownerDocument.addEventListener('click', onDocumentClick);
    ownerDocument.addEventListener('keydown', onKeydown);
    renderOptions();
}
