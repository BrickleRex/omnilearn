import { describe, expect, it } from 'vitest';
import {
  flattenReddit, flattenTweet, htmlToText, humanizeUrlSlug, normalizeUrl, redditJsonUrl, urlKind,
  guessSourceKind, xStatusId, youtubeVideoId,
} from './research/enrich';
import { applyMapEdit, coerceAngleMap, guessAngleIds, scoutTargets } from './research/angles';
import {
  claimConfidence, consensusFrom, inheritSpecificity, moreSpecific, newestDate, nicheShare, resumeFrom,
  scoutLogLine, verdictFor, coerceScout,
} from './research/pipeline';
import { DECAY_MONTHS, familyFor, horizonMonths, isStale, monthsSince, recencyFactor } from './research/decay';
import { emptyJob, pushLog, LOG_CAP } from './research/job';
import type { AngleMap, SourceKind } from '../../shared/skills';

// ---------- url kinds ----------

describe('urlKind', () => {
  it('recognises the platforms that need special fetching', () => {
    expect(urlKind('https://x.com/foo/status/1234567890')).toBe('x');
    expect(urlKind('https://twitter.com/foo/status/1234567890')).toBe('x');
    expect(urlKind('https://www.reddit.com/r/sales/comments/abc/x/')).toBe('reddit');
    expect(urlKind('https://old.reddit.com/r/sales/comments/abc/x/')).toBe('reddit');
    expect(urlKind('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(urlKind('https://youtu.be/abc')).toBe('youtube');
    expect(urlKind('https://www.facebook.com/groups/x/posts/1')).toBe('facebook');
    expect(urlKind('https://blog.example.com/post')).toBe('web');
    expect(urlKind('not a url')).toBe('web');
  });

  it('guesses a corpus kind for plain web urls', () => {
    expect(guessSourceKind('https://docs.example.com/rules')).toBe('docs');
    expect(guessSourceKind('https://blog.example.com/post')).toBe('blog');
    expect(guessSourceKind('https://www.reddit.com/r/sales/comments/a/b/')).toBe('reddit');
    expect(guessSourceKind('https://x.com/a/status/1')).toBe('x');
  });
});

describe('normalizeUrl', () => {
  it('folds the differences that do not change the page', () => {
    expect(normalizeUrl('https://www.Example.com/post/?utm_source=x#frag')).toBe('https://example.com/post');
    expect(normalizeUrl('http://example.com/post/')).toBe(normalizeUrl('https://www.example.com/post'));
  });
  it('keeps a meaningful query', () => {
    expect(normalizeUrl('https://youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc');
  });
});

describe('xStatusId', () => {
  it('pulls the numeric id out of a permalink', () => {
    expect(xStatusId('https://x.com/someone/status/1789012345678901234')).toBe('1789012345678901234');
    expect(xStatusId('https://twitter.com/someone/statuses/1789012345?s=20')).toBe('1789012345');
  });
  it('returns null when there is no status', () => {
    expect(xStatusId('https://x.com/someone')).toBeNull();
  });
});

describe('redditJsonUrl', () => {
  it('drops the query and the trailing slash before appending .json', () => {
    expect(redditJsonUrl('https://www.reddit.com/r/sales/comments/abc/title/?sort=top'))
      .toBe('https://www.reddit.com/r/sales/comments/abc/title.json');
  });
  it('is idempotent', () => {
    const once = redditJsonUrl('https://www.reddit.com/r/sales/comments/abc/title/');
    expect(redditJsonUrl(once)).toBe(once);
  });
});

describe('youtubeVideoId', () => {
  it('handles watch, youtu.be and shorts', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/')).toBeNull();
  });
});

// ---------- flattening ----------

describe('flattenReddit', () => {
  const listing = [
    { data: { children: [{ kind: 't3', data: { title: 'Reply rates?', selftext: 'What are you seeing?' } }] } },
    {
      data: {
        children: [
          { kind: 't1', data: { body: 'six percent', score: 12, author: 'ann' } },
          { kind: 't1', data: { body: 'two percent', score: 40, author: 'bob', replies: { data: { children: [{ kind: 't1', data: { body: 'nested take', score: 5, author: 'cy' } }] } } } },
        ],
      },
    },
  ];

  it('puts title and selftext first, then comments loudest-first', () => {
    const text = flattenReddit(listing);
    expect(text.startsWith('Reply rates?\n\nWhat are you seeing?')).toBe(true);
    expect(text.indexOf('bob')).toBeLessThan(text.indexOf('ann'));
    expect(text).toContain('nested take');
  });

  it('caps the comment count', () => {
    const many = [listing[0], { data: { children: Array.from({ length: 90 }, (_, i) => ({ kind: 't1', data: { body: `c${i}`, score: i, author: 'x' } })) } }];
    const lines = flattenReddit(many, 30).split('\n\n');
    expect(lines.length).toBe(32); // title + selftext + 30 comments
  });

  it('survives junk', () => {
    expect(flattenReddit(null)).toBe('');
    expect(flattenReddit({})).toBe('');
  });
});

describe('flattenTweet', () => {
  it('prefers the long-form note text', () => {
    const text = flattenTweet({ text: 'short', note_tweet: { text: 'the whole thread body' }, user: { name: 'Ann', screen_name: 'ann' } });
    expect(text).toContain('the whole thread body');
    expect(text).not.toContain('short');
  });
  it('falls back to text', () => {
    expect(flattenTweet({ text: 'just this' })).toBe('just this');
  });
});

describe('htmlToText', () => {
  it('strips scripts, styles and tags and collapses whitespace', () => {
    const html = '<html><style>p{color:red}</style><script>evil()</script><p>Hello   there</p><p>Second &amp; last</p></html>';
    expect(htmlToText(html)).toBe('Hello there\nSecond & last');
  });
});

describe('humanizeUrlSlug', () => {
  it('reads the slug facebook leaves us', () => {
    expect(humanizeUrlSlug('https://www.facebook.com/groups/coldemailers/posts/warm-up-schedule-that-worked-12345'))
      .toBe('warm up schedule that worked');
  });
});

// ---------- angle map ----------

describe('coerceAngleMap', () => {
  it('slugs ids, clamps estSources and keeps everything kept', () => {
    const map = coerceAngleMap({
      angles: [
        { id: 'Who To Email', title: 'Who to email', level: 'foundation', estSources: 999 },
        { id: 'icp', title: 'Ideal customer', parentId: 'Who To Email', level: 'nonsense', estSources: -4 },
      ],
    });
    expect(map.angles.map((a) => a.id)).toEqual(['who-to-email', 'icp']);
    expect(map.angles[0].estSources).toBe(40);
    expect(map.angles[1].estSources).toBe(1);
    expect(map.angles[1].level).toBe('working');
    expect(map.angles.every((a) => a.kept)).toBe(true);
    expect(map.angles[1].parentId).toBe('who-to-email');
  });

  it('keeps the niche/general scope, defaulting to general', () => {
    const map = coerceAngleMap({
      angles: [
        { id: 'a', title: 'Insurance exec buying calendar', scope: 'niche' },
        { id: 'b', title: 'Subject lines', scope: 'general' },
        { id: 'c', title: 'Follow-ups' },
        { id: 'd', title: 'Junk scope', scope: 'nonsense' },
      ],
    });
    expect(map.angles.map((a) => a.scope)).toEqual(['niche', 'general', 'general', 'general']);
  });

  it('drops angles whose parentId does not resolve', () => {
    const map = coerceAngleMap({ angles: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parentId: 'ghost' }] });
    expect(map.angles.map((a) => a.id)).toEqual(['a']);
  });

  it('flattens three levels down to two', () => {
    const map = coerceAngleMap({
      angles: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', parentId: 'a' }, { id: 'c', title: 'C', parentId: 'b' }],
    });
    expect(map.angles.find((a) => a.id === 'c')?.parentId).toBe('a');
  });

  it('makes duplicate ids unique and orders children under their parent', () => {
    const map = coerceAngleMap({
      angles: [
        { id: 'a', title: 'A' }, { id: 'z', title: 'Z' },
        { id: 'a', title: 'A again', parentId: 'a' },
      ],
    });
    expect(map.angles.map((a) => a.id)).toEqual(['a', 'a-2', 'z']);
  });

  it('shrugs off junk', () => {
    expect(coerceAngleMap(null).angles).toEqual([]);
    expect(coerceAngleMap({ angles: [{ title: '' }] }).angles).toEqual([]);
  });
});

const ladder = (): AngleMap => coerceAngleMap({
  angles: [
    { id: 'targeting', title: 'Who to email' },
    { id: 'icp', title: 'Ideal customer profile', parentId: 'targeting' },
    { id: 'triggers', title: 'Timing triggers', parentId: 'targeting' },
    { id: 'metrics', title: 'Measuring and iterating' },
  ],
});

describe('scoutTargets', () => {
  it('scouts kept leaves, not the parents their children cover', () => {
    expect(scoutTargets(ladder()).map((a) => a.id)).toEqual(['icp', 'triggers', 'metrics']);
  });

  it('scouts a kept parent whose children are all unchecked', () => {
    const map = ladder();
    for (const a of map.angles) if (a.parentId) a.kept = false;
    expect(scoutTargets(map).map((a) => a.id)).toEqual(['targeting', 'metrics']);
  });

  it('handles a missing map', () => {
    expect(scoutTargets(undefined)).toEqual([]);
  });
});

describe('applyMapEdit', () => {
  it('unchecks the whole subtree when a parent is unchecked', () => {
    const current = ladder();
    const edited: AngleMap = { angles: current.angles.map((a) => ({ ...a, kept: a.id !== 'targeting' })) };
    const next = applyMapEdit(current, edited);
    expect(next.angles.filter((a) => a.kept).map((a) => a.id)).toEqual(['metrics']);
  });

  it('ignores unknown ids and edits other than kept/order', () => {
    const current = ladder();
    const next = applyMapEdit(current, {
      angles: [
        { id: 'metrics', title: 'HACKED', level: 'advanced', kept: true, estSources: 999 },
        { id: 'ghost', title: 'nope', level: 'working', kept: true, estSources: 1 },
      ],
    });
    expect(next.angles.find((a) => a.id === 'metrics')?.title).toBe('Measuring and iterating');
    expect(next.angles.some((a) => a.id === 'ghost')).toBe(false);
    expect(next.angles).toHaveLength(4); // omitted angles keep their old state
  });

  it('takes the edited order for top-level angles', () => {
    const current = ladder();
    const next = applyMapEdit(current, {
      angles: [{ ...current.angles[3] }, { ...current.angles[0] }],
    });
    expect(next.angles.map((a) => a.id)).toEqual(['metrics', 'targeting', 'icp', 'triggers']);
  });
});

describe('guessAngleIds', () => {
  it('only fires on an unambiguous mention', () => {
    expect(guessAngleIds(ladder(), 'Notes on timing triggers that worked')).toEqual(['triggers']);
    expect(guessAngleIds(ladder(), 'Something else entirely')).toEqual([]);
  });
});

// ---------- decay ----------

describe('decay horizons', () => {
  it('routes angles to one table', () => {
    expect(familyFor({ id: 'warmup', title: 'Domain warm-up' })).toBe('deliverability');
    expect(familyFor({ id: 'deliverability', title: 'Landing in the inbox' })).toBe('deliverability');
    expect(familyFor({ id: 'stack', title: 'Choosing a sequencer tool' })).toBe('tooling');
    expect(familyFor({ id: 'opener', title: 'First line' })).toBe('copy');
    expect(horizonMonths({ id: 'warmup', title: 'Domain warm-up' })).toBe(DECAY_MONTHS.deliverability);
    expect(horizonMonths(undefined)).toBe(DECAY_MONTHS.copy);
  });

  it('measures months and staleness against the horizon', () => {
    const now = new Date('2026-09-06T00:00:00Z');
    expect(Math.round(monthsSince('2025-09-06', now))).toBe(12);
    expect(monthsSince(undefined, now)).toBe(Number.POSITIVE_INFINITY);
    expect(isStale('2025-11-03', { id: 'warmup', title: 'Domain warm-up' }, now)).toBe(true);   // 10 > 9
    expect(isStale('2026-05-12', { id: 'warmup', title: 'Domain warm-up' }, now)).toBe(false);
    expect(isStale('2025-11-03', { id: 'opener', title: 'First line' }, now)).toBe(false);      // copy decays slowly
  });

  it('decays recency to a floor, never below', () => {
    const now = new Date('2026-09-06T00:00:00Z');
    expect(recencyFactor('2026-08-01', 9, now)).toBe(1);
    expect(recencyFactor('2010-01-01', 9, now)).toBe(0.5);
    expect(recencyFactor(undefined, 9, now)).toBe(0.6);
  });
});

// ---------- confidence ----------

describe('claimConfidence', () => {
  const now = new Date('2026-09-06T00:00:00Z');

  it('rewards strong, recent, widely-supported claims', () => {
    const c = claimConfidence({ reputations: [0.95, 0.8, 0.8], soundnesses: [0.95, 0.8, 0.8], newest: '2026-08-01', horizon: 36, consensus: 3, now });
    expect(c).toBeGreaterThan(0.8);
    expect(verdictFor(c, { sources: 3 })).toBe('solid');
    expect(verdictFor(c, { sources: 1 })).toBe('likely'); // one source is never solid
  });

  it('punishes a lone weak source', () => {
    const c = claimConfidence({ reputations: [0.35], soundnesses: [0.4], newest: '2026-08-01', horizon: 36, consensus: 1, now });
    expect(c).toBeLessThan(0.5);
    expect(verdictFor(c, {})).toBe('likely');
  });

  it('drops with age, hardest on a fast-decaying angle', () => {
    const base = { reputations: [0.8], soundnesses: [0.8], consensus: 2, now };
    const fresh = claimConfidence({ ...base, newest: '2026-08-01', horizon: 9 });
    const old = claimConfidence({ ...base, newest: '2024-08-01', horizon: 9 });
    expect(old).toBeLessThan(fresh);
    expect(claimConfidence({ ...base, newest: '2024-08-01', horizon: 36 })).toBeGreaterThan(old);
  });

  it('shaves contested claims and never leaves 0..1', () => {
    const args = { reputations: [0.9], soundnesses: [0.9], newest: '2026-08-01', horizon: 36, consensus: 3, now };
    expect(claimConfidence({ ...args, contested: true })).toBeLessThan(claimConfidence(args));
    const max = claimConfidence({ reputations: [1, 1], soundnesses: [1, 1], newest: '2026-09-01', horizon: 36, consensus: 99, now });
    expect(max).toBeLessThanOrEqual(1);
    expect(claimConfidence({ reputations: [], soundnesses: [], horizon: 9, consensus: 0, now })).toBeGreaterThanOrEqual(0);
  });
});

describe('claimConfidence with a target', () => {
  const now = new Date('2026-09-06T00:00:00Z');
  const base = { reputations: [0.8, 0.8], soundnesses: [0.8, 0.8], newest: '2026-08-01', horizon: 36, consensus: 3, now };

  it('scores a perfect fit exactly like a frame with no target at all', () => {
    expect(claimConfidence({ ...base, relevance: 1 })).toBe(claimConfidence(base));
  });

  it('shaves a claim the further it sits from the target, never past 0.7 of it', () => {
    const full = claimConfidence(base);
    const half = claimConfidence({ ...base, relevance: 0.5 });
    const none = claimConfidence({ ...base, relevance: 0 });
    expect(half).toBeLessThan(full);
    expect(none).toBeLessThan(half);
    expect(none).toBeCloseTo(Math.round(full * 0.7 * 100) / 100, 2);
  });

  it('clamps a nonsense relevance into 0..1', () => {
    expect(claimConfidence({ ...base, relevance: 9 })).toBe(claimConfidence({ ...base, relevance: 1 }));
    expect(claimConfidence({ ...base, relevance: -3 })).toBe(claimConfidence({ ...base, relevance: 0 }));
  });
});

describe('inheritSpecificity', () => {
  it('takes the highest specificity among sources that are really about the target', () => {
    const fit = inheritSpecificity([
      { specificity: 'general', relevance: 0.3 },
      { specificity: 'adjacent', relevance: 0.6 },
      { specificity: 'niche', relevance: 0.9 },
    ]);
    expect(fit).toEqual({ specificity: 'niche', relevance: 0.9 });
  });

  it('ignores a niche source the assessor found barely relevant', () => {
    const fit = inheritSpecificity([
      { specificity: 'niche', relevance: 0.2 },
      { specificity: 'adjacent', relevance: 0.7 },
    ]);
    expect(fit).toEqual({ specificity: 'adjacent', relevance: 0.7 });
  });

  it('reads as a general rule when nothing clears the bar', () => {
    expect(inheritSpecificity([{ specificity: 'niche', relevance: 0.1 }])).toEqual({ specificity: 'general', relevance: 0.1 });
  });

  it('stays silent when the frame has no target', () => {
    expect(inheritSpecificity([{}, {}])).toEqual({});
  });

  it('ranks niche over adjacent over general', () => {
    expect(moreSpecific('general', 'niche')).toBe('niche');
    expect(moreSpecific('adjacent', 'general')).toBe('adjacent');
    expect(moreSpecific(undefined, 'general')).toBe('general');
    expect(moreSpecific(undefined, undefined)).toBeUndefined();
  });
});

describe('verdictFor', () => {
  it('puts stale ahead of everything and contested ahead of the score', () => {
    expect(verdictFor(0.95, { stale: true })).toBe('stale');
    expect(verdictFor(0.95, { contested: true })).toBe('contested');
    expect(verdictFor(0.95, { contested: true, stale: true })).toBe('stale');
    expect(verdictFor(0.7, { sources: 2 })).toBe('solid');
    expect(verdictFor(0.69, { sources: 2 })).toBe('likely');
  });
});

describe('consensusFrom', () => {
  const kinds: Record<string, SourceKind> = { s1: 'reddit', s2: 'blog', s3: 'reddit', s4: 'docs' };
  const kindOf = (id: string) => kinds[id];

  it('marks every supporting kind as agreeing when nothing is contested', () => {
    expect(consensusFrom(['s1', 's2'], undefined, kindOf)).toEqual({ reddit: 'agree', blog: 'agree' });
  });

  it('splits a kind that appears on both sides into mixed', () => {
    const grid = consensusFrom(['s1', 's2', 's3'], { for: ['s1', 's2'], against: ['s3'] }, kindOf);
    expect(grid).toEqual({ reddit: 'mixed', blog: 'agree' });
  });

  it('marks a kind that only opposes as disagreeing', () => {
    expect(consensusFrom(['s2', 's4'], { for: ['s2'], against: ['s4'] }, kindOf)).toEqual({ blog: 'agree', docs: 'disagree' });
  });

  it('ignores unknown source ids', () => {
    expect(consensusFrom(['nope'], undefined, kindOf)).toEqual({});
  });
});

describe('newestDate', () => {
  it('picks the latest parseable date and tolerates month precision', () => {
    expect(newestDate(['2026-01-15', '2026-07', undefined, 'garbage'])).toBe('2026-07');
    expect(newestDate([undefined, 'nope'])).toBeUndefined();
  });
});

// ---------- resume ----------

describe('resumeFrom', () => {
  const all = { map: true, scouts: true, enriched: true, assessed: true, reconciled: true, architected: true };

  it('picks the first phase whose artifact is missing', () => {
    expect(resumeFrom({ ...all, map: false })).toBe('cartography');
    expect(resumeFrom({ ...all, scouts: false })).toBe('scouting');
    expect(resumeFrom({ ...all, enriched: false })).toBe('enriching');
    expect(resumeFrom({ ...all, assessed: false })).toBe('assessing');
    expect(resumeFrom({ ...all, reconciled: false })).toBe('reconciling');
    expect(resumeFrom({ ...all, architected: false })).toBe('architecting');
    expect(resumeFrom(all)).toBe('done');
  });

  it('resumes at the earliest gap, not the latest', () => {
    expect(resumeFrom({ ...all, scouts: false, architected: false })).toBe('scouting');
  });
});

// ---------- scout coercion ----------

describe('coerceScout', () => {
  it('keeps only http(s) sources, dedupes them and drops claims with no known url', () => {
    const result = coerceScout({
      sources: [
        { url: 'https://www.reddit.com/r/sales/comments/a/b/', kind: 'reddit', title: 'Thread', hasRealNumbers: true, date: '2026-05-12' },
        { url: 'https://www.reddit.com/r/sales/comments/a/b?utm_source=x', kind: 'reddit', title: 'dupe' },
        { url: 'javascript:alert(1)', kind: 'blog', title: 'bad' },
        { url: 'https://blog.example.com/x', kind: 'wat', title: '' },
      ],
      claims: [
        { text: 'Short subject lines get more opens.', sourceUrls: ['https://www.reddit.com/r/sales/comments/a/b/'] },
        { text: 'Unsupported hand-wave.', sourceUrls: ['https://somewhere.else/x'] },
        { text: 'tiny', sourceUrls: ['https://blog.example.com/x'] },
      ],
    }, 'subject');

    expect(result.angleId).toBe('subject');
    expect(result.sources.map((s) => s.url)).toEqual([
      'https://www.reddit.com/r/sales/comments/a/b/',
      'https://blog.example.com/x',
    ]);
    expect(result.sources[1].kind).toBe('blog');   // bad kind falls back to a url guess
    expect(result.sources[1].title).toContain('blog.example.com');
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].sourceUrls).toEqual(['https://reddit.com/r/sales/comments/a/b']);
  });

  it('keeps the wide-to-narrow tag, defaulting to general, and counts the niche rung itself', () => {
    const result = coerceScout({
      sources: [
        { url: 'https://a.example.com/1', kind: 'blog', title: 'Niche', specificity: 'niche' },
        { url: 'https://b.example.com/2', kind: 'blog', title: 'Adjacent', specificity: 'adjacent' },
        { url: 'https://c.example.com/3', kind: 'blog', title: 'Untagged' },
        { url: 'https://d.example.com/4', kind: 'blog', title: 'Junk tag', specificity: 'very-niche' },
      ],
      nicheFound: 4,   // the scout's own count is never trusted over its list
      claims: [],
    }, 'targeting');
    expect(result.sources.map((s) => s.specificity)).toEqual(['niche', 'adjacent', 'general', 'general']);
    expect(result.nicheFound).toBe(1);
  });

  it('returns empty structures for junk', () => {
    expect(coerceScout(null, 'a')).toEqual({ angleId: 'a', sources: [], claims: [], nicheFound: 0 });
  });
});

describe('nicheShare', () => {
  it('measures how much of the ladder is niche-specific', () => {
    const map = coerceAngleMap({
      angles: [
        { id: 'a', title: 'A', scope: 'niche' },
        { id: 'b', title: 'B', scope: 'niche' },
        { id: 'c', title: 'C' },
        { id: 'd', title: 'D', scope: 'general' },
      ],
    });
    expect(nicheShare(map)).toBe(0.5);
    expect(nicheShare({ angles: [] })).toBe(0);
  });
});

describe('scoutLogLine', () => {
  const result = {
    sources: [
      ...Array.from({ length: 4 }, () => ({ specificity: 'niche' as const })),
      ...Array.from({ length: 3 }, () => ({ specificity: 'adjacent' as const })),
      ...Array.from({ length: 3 }, () => ({ specificity: 'general' as const })),
    ],
    claims: Array.from({ length: 6 }, () => ({ text: 'x', sourceUrls: [] })),
  };

  it('reports the ladder split when the frame has a target', () => {
    expect(scoutLogLine('Insurance exec buying calendar', result, true))
      .toBe("scout: 'Insurance exec buying calendar' found 10 sources (4 niche, 3 adjacent, 3 general)");
  });

  it('keeps the old sources-and-claims line without a target', () => {
    expect(scoutLogLine('Subject lines', result, false)).toBe("scout: 'Subject lines' found 10 sources, 6 claims");
  });

  it('says one source, not 1 sources', () => {
    expect(scoutLogLine('X', { sources: [{ specificity: 'general' as const }], claims: [] }, false))
      .toBe("scout: 'X' found 1 source, 0 claims");
  });
});

// ---------- job log ----------

describe('job log', () => {
  it('keeps only the last lines', () => {
    const job = emptyJob();
    for (let i = 0; i < LOG_CAP + 20; i++) pushLog(job, `line ${i}`);
    expect(job.log).toHaveLength(LOG_CAP);
    expect(job.log[LOG_CAP - 1]).toBe(`line ${LOG_CAP + 19}`);
  });

  it('starts idle with zeroed progress', () => {
    expect(emptyJob()).toEqual({ phase: 'idle', progress: { anglesKept: 0, anglesDone: 0, sources: 0, claims: 0, modules: 0 }, log: [] });
  });
});
