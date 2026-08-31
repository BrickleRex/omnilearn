import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** Markdown -> sanitized HTML. Never trust the model, never trust the cache. */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? '', { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/** SVG figure -> sanitized SVG markup (server sanitizes too; belt and braces). */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg ?? '', { USE_PROFILES: { svg: true, svgFilters: true } });
}

export function Markdown({ md, className }: { md: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(md), [md]);
  return <div className={className ? `md ${className}` : 'md'} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Figure({
  svg, className, testId,
}: { svg: string; className?: string; testId?: string }) {
  const html = useMemo(() => sanitizeSvg(svg), [svg]);
  if (!html.trim()) return null;
  return (
    <figure
      className={className ? `figure ${className}` : 'figure'}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
