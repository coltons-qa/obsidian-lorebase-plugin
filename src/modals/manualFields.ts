/**
 * LOREBASE - Manual fields in the editors
 *
 * Owned, count and replay/rewatch/reread have no provider source; the user fills them in.
 * The game, book and video editors share this markup and binding instead of each keeping
 * a copy. Owned and count sit in the details grid; the replay flag is a switch in Quick
 * Settings, like Favorite.
 */

import { t } from '../localization';

export interface ManualFieldValues {
    owned: string;
    count: number | null;
    repeatable: boolean;
}

/** Owned and count inputs for the details grid. `ownedOptions` become the suggestions. */
export function manualFieldInputsHtml(options: { ownedOptions: readonly string[]; listId: string; wide?: boolean }): string {
    const fieldClass = `lorebase-editmode-field${options.wide ? ' is-wide' : ''}`;
    const suggestions = options.ownedOptions.map((value) => `<option value="${value}"></option>`).join('');
    return `
        <label class="${fieldClass}"><span class="lorebase-editmode-field-label">${t('templateFieldOwned')}</span><input class="lorebase-editmode-input" data-manual-field="owned" type="text" placeholder="${options.ownedOptions.join(' / ')}" list="${options.listId}" /></label>
        <datalist id="${options.listId}">${suggestions}</datalist>
        <label class="${fieldClass}"><span class="lorebase-editmode-field-label">${t('templateFieldCount')}</span><input class="lorebase-editmode-input" data-manual-field="count" type="number" min="0" step="1" /></label>
    `;
}

/**
 * The replay/rewatch/reread switch for Quick Settings. Uses its own attribute rather than
 * `data-toggle`, which the editors' generic switch handlers listen for.
 */
export function repeatableSwitchHtml(label: string): string {
    return `
        <label class="lorebase-editmode-switch-row">
            <span class="lorebase-editmode-switch-label">${label}</span>
            <button type="button" class="lorebase-editmode-switch" data-manual-toggle="repeatable" aria-label="${label}" aria-pressed="false"><span class="lorebase-editmode-switch-thumb"></span></button>
        </label>
    `;
}

/** Fills the manual fields from `initial` and reports every edit through `onChange`. */
export function bindManualFields(
    root: HTMLElement,
    initial: ManualFieldValues,
    onChange: (values: ManualFieldValues) => void
): void {
    const values: ManualFieldValues = { ...initial };
    const owned = root.querySelector<HTMLInputElement>('[data-manual-field="owned"]');
    const count = root.querySelector<HTMLInputElement>('[data-manual-field="count"]');
    const repeatable = root.querySelector<HTMLButtonElement>('[data-manual-toggle="repeatable"]');

    const renderSwitch = (): void => {
        if (!repeatable) return;
        repeatable.setAttr('aria-pressed', String(values.repeatable));
        repeatable.toggleClass('is-active', values.repeatable);
    };

    if (owned) {
        owned.value = values.owned;
        owned.addEventListener('input', () => {
            values.owned = owned.value;
            onChange({ ...values });
        });
    }
    if (count) {
        count.value = values.count === null ? '' : String(values.count);
        count.addEventListener('input', () => {
            const parsed = Number.parseInt(count.value, 10);
            values.count = Number.isFinite(parsed) ? parsed : null;
            onChange({ ...values });
        });
    }
    if (repeatable) {
        renderSwitch();
        repeatable.addEventListener('click', (event) => {
            event.preventDefault();
            values.repeatable = !values.repeatable;
            renderSwitch();
            onChange({ ...values });
        });
    }
}
