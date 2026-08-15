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
 * This guard has to survive the stylesheet growing, so it never reads raw text
 * as structure. Per CSS Syntax Level 3 a `{`, `}` or `;` is structural
 * everywhere except inside four things: a string, a url() token, a comment, or
 * an escape sequence. All four are enumerated in opaqueEnd() and every scanner
 * routes through it, so covering a new one is a single edit rather than four.
 *
 * That enumeration is the point. Three earlier rounds of this test each fixed
 * the one shape that had been reported and left a sibling of the same bug in
 * place: a flat regex missed at-rules and selector lists, brace matching missed
 * quoting, and quote awareness missed url() tokens and bare escapes. Working
 * from the spec's token list instead of the latest symptom is what closed it.
 *
 * Each shape has its own self-test below, because a guard that silently matches
 * nothing looks exactly like a guard that passes. The implementation was also
 * differential-tested against postcss across the full corpus of shapes here and
 * agreed on every one; postcss is not imported, since it is only present
 * transitively via vitest and is not a declared dependency.
 *
 * It is deliberately not a full CSS parser. It handles the four opaque regions
 * plus braces and semicolons, which is the whole grammar needed to locate
 * custom properties inside :root.
 */

const styles = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');

function isQuote(character: string): boolean {
    return character === '"' || character === "'";
}

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

/** True when `url(` starts here as a function token rather than an identifier tail. */
function startsUrlToken(css: string, index: number): boolean {
    if (!/^url\(/i.test(css.slice(index, index + 4))) return false;
    const previous = index > 0 ? css[index - 1] : '';
    return !/[\w-]/.test(previous);
}

/**
 * Index just past an unquoted url() token. Per CSS Syntax Level 3 these run to
 * the first `)` and may legally contain raw braces and semicolons.
 */
function skipUrlToken(css: string, start: number): number {
    let index = start + 4;
    while (index < css.length) {
        const character = css[index];
        if (character === '\\') {
            index += 2;
            continue;
        }
        if (isQuote(character)) {
            index = skipString(css, index);
            continue;
        }
        if (character === ')') return index + 1;
        index += 1;
    }
    return index;
}

/** Index just past a comment starting at `index`, or -1 if one does not. */
function commentEnd(css: string, index: number): number {
    if (css[index] !== '/' || css[index + 1] !== '*') return -1;
    const end = css.indexOf('*/', index + 2);
    return end === -1 ? css.length : end + 2;
}

/**
 * Index just past a region whose contents must never be read as structure, or
 * -1 if one does not start here.
 *
 * Per CSS Syntax Level 3 a `{`, `}` or `;` is structural everywhere except
 * inside a string, a url() token, a comment, or an escape sequence. Comments
 * are handled separately because stripComments() drops them while every other
 * scanner preserves them. Routing all four through one place is deliberate:
 * earlier rounds of this test fixed some scanners and not others, and the
 * inconsistency was the actual defect.
 */
function opaqueEnd(css: string, index: number): number {
    const character = css[index];
    if (character === '\\') return index + 2;
    if (isQuote(character)) return skipString(css, index);
    if (startsUrlToken(css, index)) return skipUrlToken(css, index);
    return -1;
}

/** Removes comments, preserving anything that only looks like one. */
function stripComments(css: string): string {
    let output = '';
    let index = 0;
    while (index < css.length) {
        const comment = commentEnd(css, index);
        if (comment !== -1) {
            index = comment;
            continue;
        }
        const opaque = opaqueEnd(css, index);
        if (opaque !== -1) {
            output += css.slice(index, opaque);
            index = opaque;
            continue;
        }
        output += css[index];
        index += 1;
    }
    return output;
}

/** Index just past the `}` matching the `{` at `openIndex`, ignoring opaque regions. */
function matchingBrace(css: string, openIndex: number): number {
    let depth = 0;
    let index = openIndex;
    while (index < css.length) {
        const opaque = opaqueEnd(css, index);
        if (opaque !== -1) {
            index = opaque;
            continue;
        }
        const character = css[index];
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
        const opaque = opaqueEnd(css, index);
        if (opaque !== -1) {
            index = opaque;
            continue;
        }

        const character = css[index];

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

/** Splits a rule body on the semicolons that are structural rather than opaque. */
function splitDeclarations(block: string): string[] {
    const declarations: string[] = [];
    let start = 0;
    let index = 0;
    while (index < block.length) {
        const opaque = opaqueEnd(block, index);
        if (opaque !== -1) {
            index = opaque;
            continue;
        }
        if (block[index] === ';') {
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

        it('sees past a brace in an unquoted url() token', () => {
            expect(offendersIn(`:root { --decor: url(a}b.png); ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past a semicolon in an unquoted url() token', () => {
            expect(offendersIn(`:root { --decor: url(a;b.png); ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past a data URI containing braces', () => {
            const uri = 'url(data:image/svg+xml,<style>a{fill:red}</style>)';
            expect(offendersIn(`:root { --decor: ${uri}; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('sees past a bare escaped brace outside any string', () => {
            expect(offendersIn(`:root { --decor: \\}; ${OFFENDER} }`)).toHaveLength(1);
        });

        it('does not mistake an identifier ending in url( for a url token', () => {
            expect(offendersIn(`:root { --x: myurl(1); ${OFFENDER} }`)).toHaveLength(1);
        });

        it('terminates on an unterminated string instead of hanging', () => {
            expect(() => offendersIn(':root { --decor: "unclosed; }')).not.toThrow();
        });

        it('terminates on an unterminated url() instead of hanging', () => {
            expect(() => offendersIn(':root { --decor: url(unclosed; }')).not.toThrow();
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
