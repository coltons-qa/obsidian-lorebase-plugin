import { describe, expect, it } from 'vitest';
import { coverSearchErrorKey } from '../src/modals/CoverPickerModal';

describe('coverSearchErrorKey', () => {
    it('reports a rate limit only for a rate limit', () => {
        const error = Object.assign(new Error('HTTP 429'), { status: 429 });
        expect(coverSearchErrorKey(error)).toBe('coverPickerRateLimited');
    });

    it('reports any other failure as a failed search', () => {
        expect(coverSearchErrorKey(new Error('Failed to fetch'))).toBe('coverPickerFailed');
    });
});
