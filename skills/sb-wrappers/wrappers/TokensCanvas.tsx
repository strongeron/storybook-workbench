/**
 * TokensCanvas — auto-discover design tokens from any of 4 industry standards
 * and render them as a Storybook source-of-truth story.
 *
 * Detection order (most-specific wins; multiple sources combine):
 *   1. Tailwind v4 @theme blocks   → @theme { --color-foo: ...; --spacing-md: ... }
 *   2. shadcn cssVars              → :root { --background: 0 0% 100% } + components.json present
 *   3. DTCG tokens.json            → tokens.json or *.tokens.json (W3C format)
 *   4. Plain CSS custom properties → :root { --any-name: value } as fallback
 *
 * Renders categorized sections: Colors · Typography · Spacing · Radii · Shadows · Motion.
 * Unrecognized tokens go to an "Other" section so nothing is hidden.
 *
 * @example
 * // src/stories/foundations/Tokens.stories.tsx
 * import { TokensCanvas } from '../../.storybook/wrappers/TokensCanvas';
 *
 * const meta = { title: 'Foundations/Tokens', tags: ['autodocs'] } satisfies Meta;
 * export default meta;
 * export const All: StoryObj = { render: () => <TokensCanvas /> };
 *
 * Storybook-only — never imported from app code.
 */
import { useMemo, type CSSProperties } from 'react';

type RawCss = string;
type DtcgTokenFile = Record<string, unknown>;

// Use Vite glob imports to read every CSS + tokens.json file in the repo at build time.
// These are evaluated when Storybook builds; the wrapper itself stays pure-runtime.
const cssRawFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean; query?: string; import?: string }) => Record<string, T> })
  .glob<RawCss>('../../**/*.css', { eager: true, query: '?raw', import: 'default' });

const dtcgFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<DtcgTokenFile>('../../**/tokens.json', { eager: true });

const dtcgFiles2 = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<DtcgTokenFile>('../../**/*.tokens.json', { eager: true });

const componentsJsonFiles = (import.meta as { glob: <T = unknown>(p: string, opts?: { eager: boolean }) => Record<string, T> })
  .glob<Record<string, unknown>>('../../components.json', { eager: true });

// ────────────────────────────────────────────────────────────────────────────────
// Token parsing
// ────────────────────────────────────────────────────────────────────────────────

export interface Token {
  name: string;
  value: string;
  source: 'tailwind-v4' | 'shadcn' | 'css-vars' | 'dtcg';
  sourcePath: string;
}

export interface TokenBag {
  colors: Token[];
  typography: Token[];
  spacing: Token[];
  radii: Token[];
  shadows: Token[];
  motion: Token[];
  breakpoints: Token[];
  other: Token[];
  meta: {
    sources: Array<'tailwind-v4' | 'shadcn' | 'css-vars' | 'dtcg'>;
    fileCount: number;
    totalTokens: number;
  };
}

function classify(name: string, value: string): keyof Omit<TokenBag, 'meta'> {
  const n = name.toLowerCase();
  const v = value.toLowerCase().trim();
  if (n.includes('color') || n.includes('background') || n.includes('foreground') || n.includes('primary') || n.includes('secondary') || n.includes('accent') || n.includes('destructive') || n.includes('muted') || n.includes('border') || n.includes('ring') || n.includes('chart')) return 'colors';
  if (/^#[0-9a-f]{3,8}$/.test(v) || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('oklch') || v.startsWith('oklab') || /^[0-9.]+\s+[0-9.]+%\s+[0-9.]+%$/.test(v)) return 'colors';
  if (n.includes('font') || n.includes('text') || n.includes('leading') || n.includes('tracking') || n.includes('letter-spacing')) return 'typography';
  if (n.includes('spacing') || n.includes('space-') || n.startsWith('--spacing') || n.includes('gap') || n.includes('inset')) return 'spacing';
  if (n.includes('radius') || n.includes('rounded')) return 'radii';
  if (n.includes('shadow') || n.includes('elevation')) return 'shadows';
  if (n.includes('duration') || n.includes('ease') || n.includes('transition') || n.includes('motion')) return 'motion';
  if (n.includes('breakpoint') || n.includes('screen-')) return 'breakpoints';
  return 'other';
}

function parseTailwindV4Theme(css: RawCss, sourcePath: string): Token[] {
  const tokens: Token[] = [];
  const themeBlockRegex = /@theme[^{]*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = themeBlockRegex.exec(css)) !== null) {
    const body = match[1];
    const lineRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(body)) !== null) {
      tokens.push({
        name: lineMatch[1].trim(),
        value: lineMatch[2].trim(),
        source: 'tailwind-v4',
        sourcePath,
      });
    }
  }
  return tokens;
}

function parseShadcnCssVars(css: RawCss, sourcePath: string): Token[] {
  // shadcn pattern: :root { --background: 0 0% 100% } using HSL channels
  const tokens: Token[] = [];
  const rootBlockRegex = /:root\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rootBlockRegex.exec(css)) !== null) {
    const body = match[1];
    const lineRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(body)) !== null) {
      const value = lineMatch[2].trim();
      // shadcn HSL channels look like "0 0% 100%" — wrap in hsl() for display
      const isShadcnHsl = /^\s*[\d.]+\s+[\d.]+%\s+[\d.]+%\s*$/.test(value);
      tokens.push({
        name: lineMatch[1].trim(),
        value: isShadcnHsl ? `hsl(${value})` : value,
        source: 'shadcn',
        sourcePath,
      });
    }
  }
  return tokens;
}

function parsePlainCssVars(css: RawCss, sourcePath: string): Token[] {
  const tokens: Token[] = [];
  const rootBlockRegex = /:root\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rootBlockRegex.exec(css)) !== null) {
    const body = match[1];
    const lineRegex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(body)) !== null) {
      tokens.push({
        name: lineMatch[1].trim(),
        value: lineMatch[2].trim(),
        source: 'css-vars',
        sourcePath,
      });
    }
  }
  return tokens;
}

function parseDtcg(json: DtcgTokenFile, sourcePath: string, prefix: string[] = []): Token[] {
  const tokens: Token[] = [];
  for (const [key, val] of Object.entries(json)) {
    if (key.startsWith('$')) continue;
    if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      if ('$value' in obj && typeof obj.$value !== 'object') {
        tokens.push({
          name: [...prefix, key].join('-'),
          value: String(obj.$value),
          source: 'dtcg',
          sourcePath,
        });
      } else {
        tokens.push(...parseDtcg(obj as DtcgTokenFile, sourcePath, [...prefix, key]));
      }
    }
  }
  return tokens;
}

export function discoverTokens(): TokenBag {
  const all: Token[] = [];
  const sourcesUsed = new Set<'tailwind-v4' | 'shadcn' | 'css-vars' | 'dtcg'>();
  let fileCount = 0;

  const hasShadcn = Object.keys(componentsJsonFiles).length > 0;

  for (const [path, css] of Object.entries(cssRawFiles)) {
    fileCount += 1;
    if (typeof css !== 'string') continue;

    if (css.includes('@theme')) {
      const tw = parseTailwindV4Theme(css, path);
      if (tw.length > 0) { all.push(...tw); sourcesUsed.add('tailwind-v4'); }
    }
    if (hasShadcn && css.includes(':root')) {
      const sh = parseShadcnCssVars(css, path);
      if (sh.length > 0) { all.push(...sh); sourcesUsed.add('shadcn'); }
    } else if (css.includes(':root')) {
      const pl = parsePlainCssVars(css, path);
      if (pl.length > 0) { all.push(...pl); sourcesUsed.add('css-vars'); }
    }
  }

  for (const [path, json] of [...Object.entries(dtcgFiles), ...Object.entries(dtcgFiles2)]) {
    fileCount += 1;
    const dt = parseDtcg(json, path);
    if (dt.length > 0) { all.push(...dt); sourcesUsed.add('dtcg'); }
  }

  // Dedupe by name (keep first occurrence; later sources override only via key collision)
  const seen = new Map<string, Token>();
  for (const tok of all) {
    if (!seen.has(tok.name)) seen.set(tok.name, tok);
  }
  const deduped = Array.from(seen.values());

  const bag: TokenBag = {
    colors: [], typography: [], spacing: [], radii: [], shadows: [], motion: [], breakpoints: [], other: [],
    meta: { sources: Array.from(sourcesUsed), fileCount, totalTokens: deduped.length },
  };

  for (const tok of deduped) bag[classify(tok.name, tok.value)].push(tok);
  return bag;
}

// ────────────────────────────────────────────────────────────────────────────────
// Renderers
// ────────────────────────────────────────────────────────────────────────────────

// Plain text labels — no emoji (per CONTEXT.md §wrapper-view-design). Each Section's
// swatch renderer already carries the visual cue; the heading stays clean text.
const SECTION_LABEL: Record<keyof Omit<TokenBag, 'meta'>, string> = {
  colors: 'Colors',
  typography: 'Typography',
  spacing: 'Spacing',
  radii: 'Radii',
  shadows: 'Shadows',
  motion: 'Motion',
  breakpoints: 'Breakpoints',
  other: 'Other',
};

const CARD: CSSProperties = {
  background: 'var(--color-background, white)', border: '1px solid var(--color-border-subtle, #e2e0db)', borderRadius: 8, padding: '1rem 1.2rem', marginBottom: '1rem',
};
const LABEL: CSSProperties = {
  fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground, #666)', fontWeight: 600,
};
const SWATCH: CSSProperties = {
  width: '100%', aspectRatio: '3 / 2', borderRadius: 6, border: '1px solid var(--color-border-subtle, #e2e0db)',
};

function SourceBadge({ source }: { source: Token['source'] }): JSX.Element {
  const colors: Record<Token['source'], { bg: string; fg: string }> = {
    'tailwind-v4': { bg: '#cffafe', fg: '#155e75' },
    'shadcn':      { bg: '#e0e7ff', fg: '#3730a3' },
    'css-vars':    { bg: '#f3f4f6', fg: '#374151' },
    'dtcg':        { bg: '#fef3c7', fg: '#92400e' },
  };
  const c = colors[source];
  return (
    <span style={{ background: c.bg, color: c.fg, fontSize: '0.65rem', padding: '0.05rem 0.4rem', borderRadius: 3, fontWeight: 600 }}>
      {source}
    </span>
  );
}

function ColorSwatch({ token }: { token: Token }): JSX.Element {
  return (
    <div style={CARD}>
      <div style={{ ...SWATCH, background: token.value }} />
      <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <code style={{ fontSize: '0.78rem', fontWeight: 600 }}>--{token.name}</code>
        <SourceBadge source={token.source} />
      </div>
      <code style={{ fontSize: '0.7rem', color: 'var(--color-muted-foreground, #666)', display: 'block', marginTop: '0.2rem', wordBreak: 'break-all' }}>{token.value}</code>
    </div>
  );
}

function TypeSwatch({ token }: { token: Token }): JSX.Element {
  const cssVar = `var(--${token.name}, ${token.value})`;
  const isFontSize = token.name.includes('font-size') || token.name.includes('text');
  const isFontFamily = token.name.includes('font-family') || token.name.includes('font') && !isFontSize;
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginBottom: '0.4rem' }}>--{token.name}</div>
      <div
        style={{
          fontSize: isFontSize ? cssVar : '1rem',
          fontFamily: isFontFamily ? cssVar : 'inherit',
          padding: '0.6rem 0',
        }}
      >
        Ag — The quick brown fox jumps over the lazy dog
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <code style={{ fontSize: '0.7rem', color: 'var(--color-muted-foreground, #666)' }}>{token.value}</code>
        <SourceBadge source={token.source} />
      </div>
    </div>
  );
}

function SpacingSwatch({ token }: { token: Token }): JSX.Element {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginBottom: '0.4rem' }}>--{token.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{ background: 'var(--color-brand-500, #2b5cd9)', height: 24, width: token.value, borderRadius: 3 }} />
        <code style={{ fontSize: '0.78rem' }}>{token.value}</code>
      </div>
      <div style={{ marginTop: '0.3rem' }}><SourceBadge source={token.source} /></div>
    </div>
  );
}

function RadiusSwatch({ token }: { token: Token }): JSX.Element {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginBottom: '0.4rem' }}>--{token.name}</div>
      <div style={{ width: 80, height: 80, background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: token.value, marginBottom: '0.5rem' }} />
      <code style={{ fontSize: '0.78rem' }}>{token.value}</code>
      <div style={{ marginTop: '0.3rem' }}><SourceBadge source={token.source} /></div>
    </div>
  );
}

function ShadowSwatch({ token }: { token: Token }): JSX.Element {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginBottom: '0.4rem' }}>--{token.name}</div>
      <div style={{ width: '100%', aspectRatio: '5 / 3', background: 'white', borderRadius: 8, boxShadow: token.value, marginBottom: '0.5rem' }} />
      <code style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>{token.value}</code>
      <div style={{ marginTop: '0.3rem' }}><SourceBadge source={token.source} /></div>
    </div>
  );
}

function GenericSwatch({ token }: { token: Token }): JSX.Element {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <code style={{ fontSize: '0.82rem', fontWeight: 600 }}>--{token.name}</code>
        <SourceBadge source={token.source} />
      </div>
      <code style={{ fontSize: '0.78rem', color: 'var(--color-muted-foreground, #666)', display: 'block', marginTop: '0.4rem' }}>{token.value}</code>
    </div>
  );
}

function Section({ title, tokens, renderToken }: { title: string; tokens: Token[]; renderToken: (t: Token) => JSX.Element }): JSX.Element | null {
  if (tokens.length === 0) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.7rem', borderBottom: '1px solid var(--color-border-subtle, #e2e0db)', paddingBottom: '0.4rem' }}>
        {title} <span style={{ color: 'var(--color-muted-foreground, #999)', fontWeight: 400, fontSize: '0.85rem' }}>· {tokens.length}</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.8rem' }}>
        {tokens.map((tok, i) => <div key={`${tok.name}-${i}`}>{renderToken(tok)}</div>)}
      </div>
    </section>
  );
}

export function TokensCanvas(): JSX.Element {
  const bag = useMemo(() => discoverTokens(), []);

  if (bag.meta.totalTokens === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: 720, margin: '0 auto', color: 'var(--color-muted-foreground, #666)', fontSize: '0.9rem' }}>
        <h2 style={{ margin: '0 0 0.5rem' }}>No tokens detected</h2>
        <p>TokensCanvas auto-discovers tokens from:</p>
        <ul>
          <li><strong>Tailwind v4</strong> <code>@theme</code> blocks in any CSS file</li>
          <li><strong>shadcn cssVars</strong> on <code>:root</code> (if <code>components.json</code> present)</li>
          <li><strong>DTCG</strong> <code>tokens.json</code> or <code>*.tokens.json</code></li>
          <li><strong>Plain CSS</strong> <code>:root {`{ --token-name: value }`}</code></li>
        </ul>
        <p>None of these were found. Add one of the above or pass tokens explicitly.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Design tokens · source of truth</h1>
        <p style={{ margin: '0.3rem 0 0', color: 'var(--color-muted-foreground, #666)', fontSize: '0.88rem' }}>
          {bag.meta.totalTokens} tokens · {bag.meta.fileCount} files scanned · sources:{' '}
          {bag.meta.sources.map((s, i) => (
            <span key={s}>{i > 0 ? ' · ' : ''}<SourceBadge source={s} /></span>
          ))}
        </p>
      </header>

      <Section title={SECTION_LABEL.colors}      tokens={bag.colors}      renderToken={(t) => <ColorSwatch   token={t} />} />
      <Section title={SECTION_LABEL.typography}  tokens={bag.typography}  renderToken={(t) => <TypeSwatch    token={t} />} />
      <Section title={SECTION_LABEL.spacing}     tokens={bag.spacing}     renderToken={(t) => <SpacingSwatch token={t} />} />
      <Section title={SECTION_LABEL.radii}       tokens={bag.radii}       renderToken={(t) => <RadiusSwatch  token={t} />} />
      <Section title={SECTION_LABEL.shadows}     tokens={bag.shadows}     renderToken={(t) => <ShadowSwatch  token={t} />} />
      <Section title={SECTION_LABEL.motion}      tokens={bag.motion}      renderToken={(t) => <GenericSwatch token={t} />} />
      <Section title={SECTION_LABEL.breakpoints} tokens={bag.breakpoints} renderToken={(t) => <GenericSwatch token={t} />} />
      <Section title={SECTION_LABEL.other}       tokens={bag.other}       renderToken={(t) => <GenericSwatch token={t} />} />
    </div>
  );
}
