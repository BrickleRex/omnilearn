// Source enrichment: turn a scouted URL into cached plain text, by url kind.
//
// Nothing here logs in, drives a browser, or touches a private page. X goes
// through the public syndication endpoint, Reddit through its public .json,
// YouTube through the transcript API, Facebook not at all (the body is a login
// shell, so we keep the scout's snippet). Everything else is a plain fetch.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import type { SourceKind, SourceRef } from '../../../shared/skills';
import { sourceTextFile } from '../store';
import { writeTextFile } from '../../store';

export type UrlKind = 'x' | 'reddit' | 'youtube' | 'facebook' | 'web';

const FETCH_TIMEOUT_MS = 15_000;
const TRANSCRIPT_TIMEOUT_MS = 60_000;
const WEB_CAP = 12_000;
const RICH_CAP = 24_000;
const UA = 'omnilearn/0.1 (learning app)';

// ---------- url classification ----------

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/^old\./, '');
  } catch {
    return '';
  }
}

/** Which fetch strategy a url needs. */
export function urlKind(url: string): UrlKind {
  const h = host(url);
  if (!h) return 'web';
  if (h === 'x.com' || h === 'twitter.com' || h.endsWith('.x.com') || h.endsWith('.twitter.com')) return 'x';
  if (h === 'reddit.com' || h.endsWith('.reddit.com') || h === 'redd.it') return 'reddit';
  if (h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be') return 'youtube';
  if (h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.com' || h === 'fb.watch') return 'facebook';
  return 'web';
}

/** Best guess at the corpus SourceKind when a scout returns junk. */
export function guessSourceKind(url: string): SourceKind {
  const k = urlKind(url);
  if (k !== 'web') return k === 'x' ? 'x' : (k as SourceKind);
  const h = host(url);
  if (/^docs\.|\/docs\//.test(h) || /^developers?\./.test(h) || /support\.google\.com/.test(h)) return 'docs';
  if (/podcast|spotify\.com|apple\.com\/.*podcast|transistor\.fm|buzzsprout/.test(`${h}${url}`)) return 'podcast';
  if (/^blog\.|medium\.com|substack\.com|dev\.to|linkedin\.com/.test(h)) return 'blog';
  return 'blog';
}

/** Compare/dedupe key for a url: no scheme case, no www, no tracking params, no hash. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref|ref_src|ref_url|fbclid|gclid|si|s|t)$/i.test(key)) u.searchParams.delete(key);
    }
    let out = u.toString();
    out = out.replace(/\?$/, '');
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return String(raw).trim().replace(/\/$/, '');
  }
}

/** Numeric status id out of an x.com/twitter.com permalink. */
export function xStatusId(url: string): string | null {
  const m = /\/status(?:es)?\/(\d{5,25})/.exec(String(url));
  return m ? m[1] : null;
}

/** Public .json flavour of a reddit permalink (query + trailing slash dropped first). */
export function redditJsonUrl(url: string): string {
  let clean = String(url).split('#')[0].split('?')[0].replace(/\/+$/, '');
  if (clean.endsWith('.json')) return clean;
  return `${clean}.json`;
}

export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = /\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{6,})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** "…/posts/why-warmup-matters-123" -> "why warmup matters" (all Facebook gives us). */
export function humanizeUrlSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = [...parts].reverse().find((p) => /[a-z]{3}/i.test(p) && p.includes('-')) ?? parts[parts.length - 1] ?? '';
    return slug.replace(/[-_]+/g, ' ').replace(/\b\d{6,}\b/g, '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ---------- text shaping ----------

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
};

export function htmlToText(html: string): string {
  return String(html)
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Post title + selftext + the loudest ~30 comments out of reddit's .json listing. */
export function flattenReddit(payload: unknown, maxComments = 30): string {
  const listings = Array.isArray(payload) ? payload : [payload];
  const out: string[] = [];
  const first = (listings[0] as any)?.data?.children?.[0]?.data;
  if (first) {
    if (first.title) out.push(String(first.title));
    if (first.selftext) out.push(String(first.selftext));
  }
  const comments: Array<{ score: number; body: string; author: string }> = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.kind === 't1' && node.data?.body) {
      comments.push({ score: Number(node.data.score ?? 0), body: String(node.data.body), author: String(node.data.author ?? 'someone') });
    }
    if (node.data?.children) walk(node.data.children);
    if (node.data?.replies) walk(node.data.replies);
  };
  listings.slice(1).forEach(walk);
  comments.sort((a, b) => b.score - a.score);
  for (const c of comments.slice(0, maxComments)) {
    out.push(`[${c.score}] ${c.author}: ${c.body}`);
  }
  return out.join('\n\n').trim();
}

/** The tweet text out of the syndication payload (long tweets hide in note_tweet). */
export function flattenTweet(payload: unknown): string {
  const p = payload as any;
  if (!p || typeof p !== 'object') return '';
  const note = p.note_tweet?.text ?? p.note_tweet?.note_tweet_results?.result?.text;
  const body = String(note ?? p.text ?? '').trim();
  const who = p.user?.name ? `${p.user.name} (@${p.user.screen_name ?? ''})` : '';
  const when = p.created_at ? String(p.created_at) : '';
  return [who && when ? `${who} — ${when}` : who || when, body].filter(Boolean).join('\n').trim();
}

function cap(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}\n…[truncated]` : text;
}

// ---------- the fetchers ----------

async function getText(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: '*/*', ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
}

function runTranscript(videoId: string): Promise<string> {
  const script = [
    'import os',
    'from youtube_transcript_api import YouTubeTranscriptApi as A',
    'vid = os.environ["YT_ID"]',
    'try:',
    '    parts = [s.text for s in A().fetch(vid)]',
    'except Exception:',
    '    parts = [s["text"] for s in A.get_transcript(vid)]',
    'print(" ".join(parts))',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn('uv', ['run', '--quiet', '--with', 'youtube-transcript-api', 'python', '-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, YT_ID: videoId },
    });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, TRANSCRIPT_TIMEOUT_MS);
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
    child.on('error', (e) => done(() => reject(new Error(`transcript helper could not start: ${e.message}`))));
    child.on('close', (code) => done(() => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`no transcript (${code}): ${err.trim().slice(-200)}`));
    }));
  });
}

export interface EnrichOutcome {
  fetched: SourceRef['fetched'];
  text: string;
  note?: string;   // one human-readable line for the job log
}

/**
 * Fetch and cache one source's text. Returns what we managed to get; a failure
 * is never fatal — the assessor falls back to the scout's quote.
 */
export async function enrichSource(skillId: string, source: SourceRef): Promise<EnrichOutcome> {
  const file = sourceTextFile(skillId, source.id);
  const cachedText = await fsp.readFile(file, 'utf8').catch(() => null);
  if (cachedText !== null) {
    return { fetched: source.fetched === 'failed' ? 'full' : source.fetched, text: cachedText, note: 'cached' };
  }

  const outcome = await fetchByKind(source);
  if (outcome.text) await writeTextFile(file, outcome.text);
  return outcome;
}

function snippetOf(source: SourceRef, extra = ''): string {
  return [source.title, source.quote, extra].filter(Boolean).join('\n').trim();
}

async function fetchByKind(source: SourceRef): Promise<EnrichOutcome> {
  const kind = urlKind(source.url);
  try {
    if (kind === 'x') {
      const id = xStatusId(source.url);
      if (!id) return { fetched: 'snippet', text: snippetOf(source), note: 'no status id in the url' };
      const { status, body } = await getText(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a`);
      if (status !== 200) return { fetched: 'snippet', text: snippetOf(source), note: `syndication said ${status}` };
      const text = flattenTweet(JSON.parse(body));
      if (!text) return { fetched: 'snippet', text: snippetOf(source), note: 'empty tweet payload' };
      return { fetched: 'full', text: cap(text, RICH_CAP), note: `tweet text (${words(text)})` };
    }

    if (kind === 'reddit') {
      const { status, body } = await getText(redditJsonUrl(source.url));
      if (status === 403 || status === 429) {
        return { fetched: 'snippet', text: snippetOf(source), note: 'reddit blocked from this network — works from a laptop' };
      }
      if (status !== 200) return { fetched: 'snippet', text: snippetOf(source), note: `reddit said ${status}` };
      const text = flattenReddit(JSON.parse(body));
      if (!text) return { fetched: 'snippet', text: snippetOf(source), note: 'empty reddit listing' };
      return { fetched: 'full', text: cap(text, RICH_CAP), note: `thread + comments (${words(text)})` };
    }

    if (kind === 'youtube') {
      const vid = youtubeVideoId(source.url);
      if (!vid) return { fetched: 'snippet', text: snippetOf(source), note: 'no video id in the url' };
      const text = await runTranscript(vid);
      return { fetched: 'full', text: cap(text, RICH_CAP), note: `transcript (${words(text)})` };
    }

    if (kind === 'facebook') {
      // Public post bodies are a login shell. Title + quote + the url slug is all there is.
      const text = snippetOf(source, humanizeUrlSlug(source.url));
      return { fetched: 'snippet', text, note: 'facebook body is a login wall — snippet only' };
    }

    const { status, body } = await getText(source.url, { accept: 'text/html,application/xhtml+xml' });
    if (status !== 200) return { fetched: 'failed', text: snippetOf(source), note: `page said ${status}` };
    const text = htmlToText(body);
    if (!text) return { fetched: 'failed', text: snippetOf(source), note: 'page had no readable text' };
    return { fetched: 'full', text: cap(text, WEB_CAP), note: `page text (${words(text)})` };
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 120) : 'fetch failed';
    return { fetched: kind === 'web' ? 'failed' : 'snippet', text: snippetOf(source), note: why };
  }
}

function words(text: string): string {
  const n = text.trim().split(/\s+/).length;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k words` : `${n} words`;
}
