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
 *
 * The guard below walks matched braces rather than pattern-matching a single
 * flat shape, so it also sees a :root nested inside an at-rule and a :root that
 * appears alongside other selectors in a list. Both are checked explicitly by
 * the self-tests, since a guard that silently matches nothing is worse than no
 * guard at all.
 */

const styles = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');

/** Strips comments so a commented-out block cannot register as a real one. */
function stripComments(css: string): string {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `selector { ... }` pair in the sheet, including inside at-rules. */
function eachRule(css: string, visit: (selector: string, body: string) => void): void {
    let index = 0;
    let selectorStart = 0;

    while (index < css.length) {
        const character = css[index];

        if (character === '{') {
            const selector = css.slice(selectorStart, index).trim();
            const bodyStart = index + 1;

            let depth = 1;
            let scan = bodyStart;
            while (scan < css.length && depth > 0) {
                if (css[scan] === '{') depth += 1;
                else if (css[scan] === '}') depth -= 1;
                scan += 1;
            }

            const body = css.slice(bodyStart, Math.max(bodyStart, scan - 1));
            visit(selector, body);
            // Descend so a rule wrapped in @media/@supports is still reached.
            if (body.includes('{')) eachRule(body, visit);

            index = scan;
            selectorStart = scan;
            continue;
        }

        if (character === '}') selectorStart = index + 1;
        index += 1;
    }
}

/** True when any selector in the comma-separated list targets :root. */
function targetsRoot(selector: string): boolean {
    return selector.split(',').some((part) => /:root(?![\w-])/.test(part));
}

/** Declaration bodies of every rule that applies to :root, at any nesting. */
function rootBlocks(css: string): string[] {
    const blocks: string[] = [];
    eachRule(css, (selector, body) => {
        if (targetsRoot(selector)) blocks.push(body);
    });
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

/** Aliases in :root that read a theme variable, formatted for the failure message. */
function offendersIn(css: string): string[] {
    const offenders: string[] = [];
    for (const block of rootBlocks(stripComments(css))) {
        for (const [name, value] of customProperties(block)) {
            const themeVariables = referencedVariables(value).filter(
                (variable) => !variable.startsWith('--lorebase-'),
            );
            if (themeVariables.length > 0) {
                offenders.push(`${name}: ${value}  (reads ${themeVariables.join(', ')})`);
            }
        }
    }
    return offenders;
}

describe('theme variable scope', () => {
    describe('the guard itself', () => {
        it('catches the original bug shape', () => {
            expect(offendersIn(':root { --lorebase-text-normal: var(--text-normal, #ffffff); }')).toHaveLength(1);
        });

        it('catches a :root nested inside an at-rule', () => {
            const css = '@media (max-width: 768px) { :root { --lorebase-bg-primary: var(--background-primary, #141414); } }';
            expect(offendersIn(css)).toHaveLength(1);
        });

        it('catches a :root that shares a selector list', () => {
            expect(offendersIn(':root, body { --lorebase-text-muted: var(--text-muted, #b3b3b3); }')).toHaveLength(1);
        });

        it('allows the same alias once it is scoped to body', () => {
            expect(offendersIn('body { --lorebase-text-normal: var(--text-normal, #ffffff); }')).toEqual([]);
        });

        it('allows :root to hold literals and lorebase-to-lorebase references', () => {
            const css = ':root { --lorebase-accent: #e4a47e; --lorebase-glow: var(--lorebase-accent); }';
            expect(offendersIn(css)).toEqual([]);
        });

        it('ignores a commented-out declaration', () => {
            expect(offendersIn(':root { /* --lorebase-x: var(--text-normal); */ }')).toEqual([]);
        });
    });

    describe('the real stylesheet', () => {
        it('declares at least one :root block, so the guard below is meaningful', () => {
            expect(rootBlocks(stripComments(styles)).length).toBeGreaterThan(0);
        });

        it('never resolves a theme variable inside a :root block', () => {
            const offenders = offendersIn(styles);
            expect(
                offenders,
                'These aliases read an Obsidian theme variable from :root, where it is not defined, ' +
                    'so they freeze to their dark-mode fallback. Move them to a `body` selector.\n' +
                    offenders.join('\n'),
            ).toEqual([]);
        });
    });
});
