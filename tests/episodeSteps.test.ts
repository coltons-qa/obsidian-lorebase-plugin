import { describe, expect, it } from 'vitest';
import { decrementEpisode, incrementEpisode, setPartStatus, type EpisodePart } from '../src/utils/progress';

const part = (overrides: Partial<EpisodePart> = {}): EpisodePart => ({
    episodeCurrent: 3,
    episodeTotal: 10,
    status: 'watching',
    ...overrides,
});

describe('episode steps', () => {
    it('steps down, never below zero', () => {
        const p = part({ episodeCurrent: 0 });
        decrementEpisode(p);
        expect(p.episodeCurrent).toBe(0);
    });

    it('reopens a completed part when stepping down from the total', () => {
        const p = part({ episodeCurrent: 10, status: 'completed' });
        decrementEpisode(p);
        expect(p).toMatchObject({ episodeCurrent: 9, status: 'watching' });
    });

    it('starts a planned part and clamps at the total', () => {
        const p = part({ episodeCurrent: 0, status: 'planned' });
        incrementEpisode(p);
        expect(p).toMatchObject({ episodeCurrent: 1, status: 'watching' });
    });

    it('completes a part on reaching the total and stays there', () => {
        const p = part({ episodeCurrent: 9 });
        incrementEpisode(p);
        incrementEpisode(p);
        expect(p).toMatchObject({ episodeCurrent: 10, status: 'completed' });
    });

    it('counts up without a limit when the total is unknown', () => {
        const p = part({ episodeCurrent: 12, episodeTotal: null });
        incrementEpisode(p);
        expect(p).toMatchObject({ episodeCurrent: 13, status: 'watching' });
    });

    it('fills in the episodes when a part is marked completed', () => {
        const p = part({ episodeCurrent: 4 });
        setPartStatus(p, 'completed');
        expect(p).toMatchObject({ episodeCurrent: 10, status: 'completed' });
    });

    it('leaves the count alone for any other status', () => {
        const p = part({ episodeCurrent: 4 });
        setPartStatus(p, 'paused');
        expect(p).toMatchObject({ episodeCurrent: 4, status: 'paused' });
    });
});
