import { describe, expect, it } from 'vitest';
import { readHowLongToBeatTimes } from '../src/modals/EditModal';

describe('readHowLongToBeatTimes', () => {
    it('reads the migrated hltb-* keys that Steam Sync and imports write', () => {
        expect(readHowLongToBeatTimes({
            'hltb-main': 12,
            'hltb-main-sides': 20.5,
            'hltb-perfectionist': 41,
        })).toEqual({ main: '12', mainPlusSides: '20.5', perfectionist: '41' });
    });

    it('returns nulls when the note has no HowLongToBeat data', () => {
        expect(readHowLongToBeatTimes({ title: 'Blue Prince' }))
            .toEqual({ main: null, mainPlusSides: null, perfectionist: null });
    });
});
