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
 * This guard has to survive the stylesheet growing, so every stage of it walks
 * string literals rather than pattern-matching raw text: a brace, a semicolon,
 * or a comment opener sitting inside a quoted value (content: "}") must not be
 * read as structure. Each stage is exercised by its own self-tests below,
 * because a guard that silently matches nothing looks exactly like a guard that
 * passes.
 *
 * It is deliberately not a full CSS parser. It understands strings, comments,
 * braces, and semicolons, which is the whole grammar it needs to locate custom
 * properties inside :root.
 */

const styles = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');

/** Index just past the string literal opening at `start`. Tolerates escapes and EOF. */
function skipString(css: string, start: number): number {
    const quote = css[start];
    let index = start + 1;
    while (index < css.length) {
        if (css[index] === '\\') {
            index += 2;
            continue;
        }
        if (css[index] === quote) return index + 1;
        index += 1;
    }
    return index;
}

function isQuote(character: string): boolean {
    return character === '"' || character === "'";
}

/** Removes comments without letting a `/*` inside a quoted value start one. */
function stripComments(css: string): string {
    let output = '';
    let index = 0;
    while (index < css.length) {
        const character = css[index];
        if (isQuote(character)) {
            const end = skipString(css, index);
            output += css.slice(index, end);
            index = end;
            continue;
        }
        if (character === '/' && css[index + 1] === '*') {
            const end = css.indexOf('*/', index + 2);
            index = end === -1 ? css.length : end + 2;
            continue;
        }
        output += character;
        index += 1;
    }
    return output;
}

/** Index just past the `}` matching the `{` at `openIndex`, ignoring quoted braces. */
function matchingBrace(css: string, openIndex: number): number {
    let depth = 0;
    let index = openIndex;
    while (index < css.length) {
        const character = css[index];
        if (isQuote(character)) {
            index = skipString(css, index);
            continue;
        }
        if (character === '{') depth += 1;
        else if (character === '}') {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
        index += 1;
    }
    return css.length;
}

/** Every `selector { ... }` pair in the sheet, including inside at-rules. */
function eachRule(css: string, visit: (selector: string, body: string) => void): void {
    let index = 0;
    let selectorStart = 0;

    while (index < css.length) {
        const character = css[index];

        if (isQuote(character)) {
            index = skipString(css, index);
            continue;
        }

        if (character === '{') {
            const selector = css.slice(selectorStart, index).trim();
            const close = matchingBrace(css, index);
            const body = css.slice(index + 1, Math.max(index + 1, close - 1));

            visit(selector, body);
            // Descend so a rule wrapped in @media/@supports is still reached.
            if (body.includes('{')) eachRule(body, visit);

            index = close;
            selectorStart = close;
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

/** Splits a rule body on the semicolons that are not inside a string. */
function splitDeclarations(block: string): string[] {
    const declarations: string[] = [];
    let start = 0;
    let index = 0;
    while (index < block.length) {
        const character = block[index];
        if (isQuote(character)) {
            index = skipString(block, index);
            continue;
        }
        if (character === ';') {
            declarations.push(block.slice(start, index));
            start = index + 1;
        }
        index += 1;
    }
    declarations.push(block.slice(start));
    return declarations;
}

/** Custom-property declarations, as [name, value] pairs. */
function customProperties(block: string): Array<[string, string]> {
    const properties: Array<[string, string]> = [];
    for (const declaration of splitDeclarations(block)) {
        const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(declaration);
        if (match) properties.push([match[1], match[2].trim()]);
    }
    return properties;
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

const OFFENDER = '--lorebase-text-normal: var(--text-normal, #ffffff);';

describe('theme variable scope', () => {
    describe('the guard itself', () => {
        it('catches the original bug shape', () => {
            expect(offendersIn(`:root { ${OFFENDER} }`)).toHaveLength(1);
        });

        it('catches a :root nested inside an at-rule', () => {
            expect(offendersIn(`@media (max-width: 768px) { :root { ${OFFENDER} } }`)).toHaveLength(1);
        });

        it('catches a :root that shares a selector list', () => {
            expect(offendersIn(`:root, body { ${OFFENDER} }`)).toHaveLength(1);
        });

        it('allows the same alias once it is scoped to body', () => {
            expect(offendersIn(`body { ${OFFENDER} }`)).toEqual([]);
        });

        it('allows :root to hold literals and lorebase-to-lorebase references', () => {
            const css = ':root { --lorebase-accent: #e4a47e; --lorebase-glow: var(--lorebase-accent); }';
            expect(offendersIn(css)).toEqual([]);
        });

        it('ignores a commented-out declaration', () => {
            expect(offendersIn(':root { /* --lorebase-x: var(--text-normal); */ }')).toEqual([]);
        });
    });

    /**
     * Each of these truncated the scan and hid a real offender later in the same
     * block, so the guard reported success while checking nothing.
     */
    describe('hostile values cannot truncate the scan', () => {
        it('sees past a quoted closing brace', () => {
            expect(offendersIn(`:root { --decor: "}"; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past a quoted opening brace', () => {
            expect(offendersIn(`:root { --decor: "{"; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past a quoted comment opener', () => {
            expect(offendersIn(`:root { --decor: "/*"; ${OFFENDER} }\n/* real comment */`)).toHaveLength(1);
        });

        it('sees past a quoted semicolon', () => {
            expect(offendersIn(`:root { --decor: "a;b"; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past an escaped quote', () => {
            expect(offendersIn(`:root { --decor: "\\"}"; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('handles single quotes the same way', () => {
            expect(offendersIn(`:root { --decor: '}'; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('terminates on an unterminated string instead of hanging', () => {
            expect(() => offendersIn(':root { --decor: "unclosed; }')).not.toThrow();
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
