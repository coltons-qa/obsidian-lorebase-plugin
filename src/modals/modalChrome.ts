/**
 * LOREBASE - Modal chrome
 */

const CLOSE_BUTTON_SELECTOR = '.modal-close-button, .modal-header-button';

/**
 * Removes Obsidian's built-in close button from an editor-style modal, whose Save,
 * Cancel and Escape already cover closing and where a stray click on the 'x' discarded
 * unsaved edits. `.modal-close-button` is the legacy class and `.modal-header-button`
 * the Obsidian 1.12+ one. Obsidian can add the button after `onOpen`, so this runs once
 * now and once on the next tick; the stylesheet hides it too.
 */
export function removeModalCloseButton(modalEl: HTMLElement): void {
    modalEl.querySelector(CLOSE_BUTTON_SELECTOR)?.remove();
    window.setTimeout(() => modalEl.querySelector(CLOSE_BUTTON_SELECTOR)?.remove(), 0);
}
