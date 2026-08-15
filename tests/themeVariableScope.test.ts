import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Obsidian and every community theme declare their palette variables
 * (--text-normal, --background-primary, --font-text, ...) on `body`, never on
 * `:root`. Custom properties are substituted at computed-value time against the
 * element the declaration sits on, so a `:root` alias like
 *
 *     :root { --lorebase-text-normal: var(--text-normal, #ffffff); }
 *
 * looks up --text-normal on <html>, does not find it, and freezes to the
 * hardcoded fallback for the life of the document. The fallbacks are dark-mode
 * colours, so every alias silently becomes dark-mode-only and light themes get
 * white text on a light background.
 */

const styles = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');

/** Strips comments so a commented-out block cannot register as a real one. */
function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the declaration bodies of every top-level `:root { ... }` block. */
function rootBlocks(css: string): string[] {
    const blocks: string[] = [];
    const pattern = /(^|})\s*:root\s*\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(css)) !== null) blocks.push(match[2]);
    return blocks;
}

/** Custom-property declarations, as [name, value] pairs. */
function customProperties(block: string): Array<[string, string]> {
    const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
    const declarations: Array<[string, string]> = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
        declarations.push([match[1], match[2].trim()]);
    }
    return declarations;
}

/** Names of every variable the value reads via var(), including fallbacks. */
function referencedVariables(value: string): string[] {
    return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
}

describe('theme variable scope', () => {
    it('declares at least one :root block, so the guard below is meaningful', () => {
        expect(rootBlocks(stripComments(styles)).length).toBeGreaterThan(0);
    });

    it('never resolves a theme variable inside a :root block', () => {
        const offenders: string[] = [];

        for (const block of rootBlocks(stripComments(styles))) {
            for (const [name, value] of customProperties(block)) {
                const themeVariables = referencedVariables(value).filter(
                    (variable) => !variable.startsWith('--lorebase-'),
                );
                if (themeVariables.length > 0) {
                    offenders.push(`${name}: ${value}  (reads ${themeVariables.join(', ')})`);
                }
            }
        }

        expect(
            offenders,
            'These aliases read an Obsidian theme variable from :root, where it is not defined, ' +
                'so they freeze to their dark-mode fallback. Move them to a `body` selector.\n' +
                offenders.join('\n'),
        ).toEqual([]);
    });
});
