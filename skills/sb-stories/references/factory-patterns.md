# Factory Patterns — Mock Data Close to Real Data

The textbook factory shapes (`makeFactory<T>`, `fishery`, `@faker-js/faker`) are well-documented in their own libraries. This file covers the **Storybook-specific decisions and constraints** that AI agents miss, plus the **data-layer adapter patterns** that make Storybook mocks behave like real data (TanStack Query / Inertia / Apollo / SWR / RTK Query).

The goal: **mocks should be one type import + one MSW handler away from being the real API.** When prototypes in Labs/ look and behave like production, designers can trust what they're reviewing.

## The framework-agnostic factory shape (production pattern)

A real production codebase ships a 527-line `.storybook/factories.ts` that demonstrates the framework-agnostic shape every project should converge on. Pure TypeScript, no React imports, re-usable in tests:

```ts
// .storybook/factories.ts (production pattern, abridged)
import type { Course, Category, AuthorProfile } from '@/types';

export function createMockCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: 'Philosophy',
    icon: 'book-open',
    ...overrides,
  };
}

export function createMockInstructor(overrides: Partial<AuthorProfile> = {}): AuthorProfile {
  return {
    id: 1,
    name: 'Dr. Sarah Mitchell',
    bio: 'Expert in ancient philosophy with 20 years of teaching experience.',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200',
    // ... every required field of AuthorProfile
    ...overrides,
  };
}

export function createMockCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: 1,
    title: 'Introduction to Ancient Greek Philosophy',
    state: 'published',
    category: createMockCategory(),       // ← compose
    instructor: createMockInstructor(),   // ← compose
    starts_at: '2026-03-15T18:00:00Z',    // ← static, deterministic
    ...overrides,
  };
}
```

Properties of this shape:
- **No framework imports** — no React, no Vue. Plain TS. Test code can import the same factories.
- **`createMockX` naming** — consistent verb prefix; greppable.
- **`Partial<X>` overrides** — full type-checking, can override any field.
- **Composes** — `createMockCourse` calls `createMockCategory`. Single source of truth per shape.
- **Static defaults** — no `Math.random`, no `Date.now`, no unseeded `faker`. Visual regression doesn't churn.

### Scaffolding command — `scripts/scaffold-factory.sh`

The skill ships a generator that creates the stub for you:

```bash
~/agent-skills/plugins/storybook-workbench/skills/sb-stories/scripts/scaffold-factory.sh User '@/types/user'
```

What it does:
- Finds the factories file (`.storybook/factories.ts` → `src/stories/factories/index.ts` → `src/stories/factories.ts`)
- Creates it if missing, with the header comment + ruleset
- Adds `import type { User } from '@/types/user'` if not already present
- Appends a `createMockUser(overrides: Partial<User> = {}): User` stub with a TODO
- Refuses to overwrite if `createMockUser` already exists

The stub is deliberately incomplete — `tsc` will fail until the agent fills the required fields from the imported type. That's intentional: it forces engagement with the production type.

```bash
# After running:
$ scaffold-factory.sh User '@/types/user'
✓ Appended createMockUser stub to .storybook/factories.ts
Next: open the file, fill in the TODO with deterministic defaults from @/types/user.
Then: tsc --noEmit will fail until every required field is set — that's intentional.
```

### When to scaffold (the only decision that matters, recapped)

| Situation | Pattern |
|---|---|
| 1–2 components use a shape, never deeply nested | **Inline** minimal mock in `args` |
| 3+ components share a shape | `scaffold-factory.sh <Type>` then fill the stub |
| Multiple stories need *related* entities (User + Order, list + detail) | `@mswjs/data` shared mock DB on top of these factories |
| Need realistic strings (names, emails, addresses) | `faker` **with `faker.seed(1)`** at the top of the factories module |

## When to factor (the only decision that matters)

| Situation | Pattern |
|---|---|
| 1–2 components use a shape, never deeply nested | **Inline** minimal mock in `args` |
| 3+ components share a shape | Extract a factory to `src/stories/factories/<name>.ts` |
| Multiple stories need *related* entities (User + Order, list + detail) | `@mswjs/data` shared mock DB |
| Need realistic strings (names, emails, addresses) | `faker` **with `faker.seed(1)`** at the top of the factories module |

Don't pre-factor. Wait for the duplication to actually exist.

## The four rules that matter for Storybook

### Rule 1 — Defaults must be deterministic

A factory's default output (no overrides) must be byte-identical across runs. Non-obvious because most factory tutorials use `Math.random()` / `Date.now()` / `faker` without a seed — all three break visual regression.

```ts
// ✗ Every render produces different output → VRT churn
{ id: Math.random().toString(), createdAt: new Date().toISOString() }

// ✓ Deterministic
{ id: `user-${++counter}`, createdAt: '2026-01-01T00:00:00.000Z' }
```

Faker is fine **only** with a seed set once at the top of the factories module:

```ts
import { faker } from '@faker-js/faker';
faker.seed(1);   // ← before any factory uses faker
```

### Rule 2 — Use the project's real types, not story-only shapes

The whole point of "mocks close to real data" is that the factory returns the production type:

```ts
// ✓ Import the project's actual type — same shape the API returns,
//   same shape the components consume in production
import type { User } from '@/types/user';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: `user-${++counter}`,
    email: 'user@example.test',
    name: 'Test User',
    role: 'member',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } satisfies User;
}
```

When the production type changes, TypeScript fails the factory — you find out before stories drift. **Story-only `interface MockX {}` is acceptable only when the shape is genuinely Storybook-internal** (e.g., a wrapper type that doesn't exist in production).

### Rule 3 — Factories are story/test code, never production

Two consequences:

- Put them under `src/stories/factories/` (or `.storybook/factories.ts` for a smaller project — pick one)
- Never import from `@/server/db`, `@/lib/api`, or any live data source — factories return literal objects only

The bundler must exclude these paths from production output. Vite skips `*.stories.*` by default; factories under `src/stories/factories/` ride along unless your build is unusual.

### Rule 4 — Compose factories for nested types

When the production type has nested entities, factories should call each other instead of duplicating:

```ts
import { makeAuthor } from './author';
import { makeCategory } from './category';

export function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: `course-${++counter}`,
    title: 'Default Course Title',
    state: 'published',
    instructor: makeAuthor(),       // ← compose, don't inline
    category: makeCategory(),       // ← same
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } satisfies Course;
}
```

This way, when `Author` gets a new required field, `makeAuthor` is the only file to change — `makeCourse` and every other consumer keep working.

## Named pre-built instances for common variants

For the variants you reach for repeatedly (admin user, draft article, paid order), export named instances alongside the factory:

```ts
// src/stories/factories/user.ts
export function makeUser(overrides: Partial<User> = {}): User { /* ... */ }

// Common variants — every story file imports these instead of re-deriving
export const mockUser = makeUser();
export const mockAdmin = makeUser({ role: 'admin', name: 'Admin User' });
export const mockBanned = makeUser({ status: 'banned' });
export const mockGuest = makeUser({ role: 'guest', email: undefined });
```

Usage:

```ts
import { mockUser, mockAdmin } from '@/stories/factories/user';

export const RegularView: Story = { args: { currentUser: mockUser } };
export const AdminView: Story = { args: { currentUser: mockAdmin } };
```

Diffs across stories become meaningful — you see "this story uses the admin variant" without scanning args.

## Data-layer adapters — making mocks behave like the real data layer

This is the biggest gap between "mock data in args" and "mocks close to real data." Production apps don't pass data via props — they pull it from a data layer (server-state cache, page props, GraphQL client, etc.). Storybook needs to mock that layer for prototypes to behave like the real thing.

The pattern is the same across libraries: **a decorator (or `.storybook/mocks/<layer>.tsx`) intercepts the data-layer hooks and returns factory output.** Concrete adapters:

### TanStack Query (`@tanstack/react-query`)

```tsx
// .storybook/preview.tsx (decorator)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const decorators = [
  (Story) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    return <QueryClientProvider client={queryClient}><Story /></QueryClientProvider>;
  },
];
```

Then mock the network layer with MSW so `useQuery` keys resolve to factory data:

```ts
// per-story
parameters: {
  msw: {
    handlers: [
      http.get('/api/users/:id', () => HttpResponse.json(makeUser({ role: 'admin' }))),
    ],
  },
}
```

This is the cleanest pattern — production code calls `useQuery(['user', id])` unchanged; Storybook intercepts the HTTP call with MSW.

### Inertia.js (`@inertiajs/react`)

Inertia injects shared props via `usePage()`. Mocking it requires a stand-in that returns the same shape:

```tsx
// .storybook/mocks/inertia-react.tsx
// Stub usePage, useForm, router, Link, Head, etc. with calls that return factory data.
// Pattern: define a React context providing the "page props" and a stub router with no-op methods.

export function StorybookInertiaProvider({ children, page }: { children: React.ReactNode; page: PageProps }) {
  return <InertiaPageContext.Provider value={page}>{children}</InertiaPageContext.Provider>;
}

// Stub the @inertiajs/react module so production hooks resolve to factory data
// (in main.ts: viteFinal aliases '@inertiajs/react' → '.storybook/mocks/inertia-react'
//  for the Storybook build only; production build keeps the real import)
```

Then per-story:

```ts
parameters: {
  inertia: {
    page: { props: { auth: { user: mockUser }, flash: {}, errors: {} } },
  },
}
```

The production codebase ships a full Inertia mock (`@inertiajs/react`: `usePage`, `useForm`, `router`, `Link`, `Head`, `usePoll`, `usePrefetch`, `Deferred`, `WhenVisible`, `InfiniteScroll`, `Form`, `useRemember`); see its `.storybook/mocks/inertia-react.tsx` for the exact API. For other projects: this scope is what to aim for.

### Apollo Client (GraphQL)

Use `MockedProvider` from `@apollo/client/testing`:

```tsx
import { MockedProvider } from '@apollo/client/testing';

const decorators = [
  (Story, { parameters }) => (
    <MockedProvider mocks={parameters.apollo?.mocks ?? []}>
      <Story />
    </MockedProvider>
  ),
];

// Per-story
parameters: {
  apollo: {
    mocks: [{
      request: { query: GET_USER, variables: { id: '1' } },
      result: { data: { user: makeUser() } },
    }],
  },
}
```

### SWR (`swr`)

SWR's `SWRConfig` accepts a `fetcher` you can override:

```tsx
const decorators = [
  (Story, { parameters }) => (
    <SWRConfig value={{ fetcher: parameters.swr?.fetcher ?? defaultFetcher, provider: () => new Map() }}>
      <Story />
    </SWRConfig>
  ),
];

// Per-story — return factory data based on the key
parameters: {
  swr: {
    fetcher: (key) => key === '/api/me' ? makeUser({ role: 'admin' }) : null,
  },
}
```

Or, like TanStack Query, pair SWR with MSW and don't override the fetcher.

### RTK Query (`@reduxjs/toolkit/query`)

Same MSW pattern as TanStack Query. Wrap the story in a `<Provider store={createMockStore()}>` decorator and let MSW intercept the HTTP layer.

### Choosing your adapter

If you already use MSW (or can adopt it), **MSW is the universal answer.** It intercepts at the network layer, so the data-layer hooks (`useQuery`, `useSWR`, `fetch`) work unchanged. The only data layers MSW can't reach are framework-private (Inertia shared props, Next.js Server Components, Apollo's in-memory cache) — for those, build a stub provider.

## `@mswjs/data` — the one non-obvious cross-entity pattern

When stories need *related* entities (list view + detail view fetching from the "same DB"), `@mswjs/data` gives you a shared dataset across stories without each one redefining mocks:

```ts
// src/stories/factories/db.ts
import { factory, primaryKey } from '@mswjs/data';

export const db = factory({
  user: { id: primaryKey(String), name: String, email: String, createdAt: String },
  order: { id: primaryKey(String), userId: String, amount: Number, status: () => 'pending' as 'pending' | 'paid' | 'shipped' },
});

export function seedDb() {
  db.user.create({ id: 'u1', name: 'Alice', email: 'alice@example.test' });
  db.order.create({ id: 'o1', userId: 'u1', amount: 100, status: 'paid' });
}
```

```ts
// .storybook/preview.tsx
beforeAll(() => seedDb());
export const parameters = {
  msw: { handlers: [...db.user.toHandlers('rest'), ...db.order.toHandlers('rest')] },
};
```

Different stories now see the same data without each one re-seeding.

## File layout

```
src/stories/factories/
├── seed.ts                  (single faker.seed call — imported first)
├── db.ts                    (@mswjs/data factory + seedDb)
├── user.ts                  (makeUser, mockUser, mockAdmin, ...)
├── order.ts                 (makeOrder, mockPendingOrder, ...)
├── article.ts               (project domain types)
└── index.ts                 (re-export everything for one-line story imports)
```

Stories import once: `import { mockUser, mockOrder } from '@/stories/factories'`.

For very small projects, a single `.storybook/factories.ts` is fine — split into the directory above when it crosses ~200 lines.

## Three mock layers — what most projects underuse

Production projects don't just need a data factory. The pattern that emerges in real Storybook setups (verified against a production app's 191 stories) is **three distinct mock layers**, each serving a different need:

| Layer | Purpose | Lives at | Example |
|---|---|---|---|
| **Data factories** | Type-safe entity constructors (User, Order, Course) — return literal objects matching production types | `src/stories/factories/` or `.storybook/factories.ts` | `makeUser(overrides)`, `mockAdmin` |
| **Content fixtures** | Static content that's verbose but not entity-like — long copy, FAQ items, marketing strings, lorem-ipsum-equivalent for the project's voice | `.storybook/mocks/<topic>.tsx` or `stories/**/_fixtures.tsx` | `faq-items.tsx` (e.g., production codebase: 7 FAQ entries with realistic Q+A pairs) |
| **Third-party-SDK stubs** | Stand-ins for SDKs that can't run in Storybook (analytics, framework data-layer hooks, error tracking, payment processors) | `.storybook/mocks/<sdk>.tsx` + `viteFinal` alias | `plausible-tracker.ts` (analytics no-op), `inertia-react.tsx` (data layer) |

Each layer has different rules:

- **Data factories** must be type-safe (`Partial<T>` overrides, return `T`). Already covered above.
- **Content fixtures** must be stable across runs (no timestamps, no random IDs) and *realistic* (not "Lorem ipsum" — write copy that mirrors the production voice so design review reflects real reading).
- **Third-party-SDK stubs** must match the SDK's *public* TypeScript surface so production code compiles unchanged; internals can be no-op or `console.log`.

## The underscore-prefix pattern — non-stories under `stories/`

Production codebases need helper files that live next to stories (shared fixtures, page-chrome wrappers, static previews) but **must NOT be discovered by Storybook's glob** as story files. The convention:

```
stories/
├── pages/public/courses/
│   ├── CoursesBrowseCompact.stories.tsx
│   ├── CoursesBrowseSidebar.stories.tsx
│   └── _fixtures.tsx          ← shared CATEGORIES, SAMPLE_COURSES, page chrome
├── pages/public/login/
│   ├── SignIn.stories.tsx
│   └── _static-previews.tsx   ← unmockable-state preview components
```

The leading `_` matches a project convention (Vite + Storybook respect it implicitly when stories glob is `*.stories.tsx`). The Storybook stories glob looks like:

```ts
// .storybook/main.ts
stories: ['../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)']
```

— underscore files don't match `*.stories.tsx`, so Storybook ignores them.

**Two production uses (both verified in the production codebase):**

### Use 1 — `_fixtures.tsx` for shared mocks across variants

When two or more `.stories.tsx` files for the same page need the same fixtures (a homepage in Compact and Sidebar variants both need the same SAMPLE_COURSES + CATEGORIES), put them in a sibling `_fixtures.tsx`:

```tsx
// stories/pages/public/courses/_fixtures.tsx
import { createMockCategory, createMockCourse } from '../../../../.storybook/factories';

export const CATEGORIES = [
  createMockCategory({ id: 1, name: 'Philosophy', icon: 'lightbulb' }),
  createMockCategory({ id: 2, name: 'Art History', icon: 'palette' }),
  // ...
];

export const SAMPLE_COURSES = [
  createMockCourse({ id: 1, title: '...', category: CATEGORIES[0] }),
  // ...
];
```

Each `.stories.tsx` variant imports from `./_fixtures`:

```tsx
import { CATEGORIES, SAMPLE_COURSES } from './_fixtures';

export const Default: Story = { args: { courses: SAMPLE_COURSES, categories: CATEGORIES } };
```

**Why this beats `.storybook/factories.ts`:** factories return entities by type; fixtures return *the exact composition this page needs* (e.g., "courses sorted by relevance, three categories selected, two enrollments shown"). Page-shaped, not type-shaped.

### Use 2 — `_static-previews.tsx` for unmockable states

Some states are hard or impossible to seed via the live mock layer:

- **In-flight states** — the form is mid-submission, processing indicator showing, before any callback fires
- **Server-validation errors mid-flight** — the moment the server returned an error but the UI hasn't reset
- **Transitional states** — the moment between two animations
- **Removed-on-success states** — UI feedback that's already been dismissed by the time live state machines settle

For these, build a **static preview component** that **mirrors the production primitives** but fakes the state plumbing:

```tsx
// stories/pages/public/login/_static-previews.tsx
/**
 * Static previews for sign-in flow states the live mocked components can't easily seed
 * (in-flight processing, server validation errors, removed-on-success feedback).
 *
 * Each preview composes the exact same primitives (`Button`, `Input`, `GoogleButton`,
 * `Modal.*`, `Mail` icon) used by the production `SignInForm` / `SignInModal`, so design
 * review reflects real visuals — only the state plumbing is faked.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
// ... import the SAME primitives production uses

export type SignInBodyVariant = 'idle' | 'sending' | 'error';

export function SignInBody({ variant }: { variant: SignInBodyVariant }) {
  const errorText = variant === 'error' ? 'Please enter a valid email.' : undefined;
  const seededValue = variant === 'error' ? 'not-an-email' : '';
  const processing = variant === 'sending';

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <Input label="Email" value={seededValue} error={errorText} onChange={() => {}} />
      <Button type="submit" disabled={processing}>
        {processing ? 'Signing in...' : 'Sign in'}
      </Button>
    </form>
  );
}
```

Then the story file uses these static preview components for the hard-to-mock states:

```tsx
// stories/pages/public/login/SignIn.stories.tsx
import { SignInBody } from './_static-previews';

export const Sending: Story = {
  render: () => <SignInBody variant="sending" />,
};

export const ValidationError: Story = {
  render: () => <SignInBody variant="error" />,
};
```

**The rule:** "mirror production primitives, fake only the state plumbing." If you replicate the look but use *different* primitives, the static preview drifts away from production visuals — which defeats the purpose.

## Per-story context-override provider — generalized from Inertia stub

A pattern that emerges when a project uses any context-injected data layer (Inertia.js `usePage`, React Router's location, custom session contexts): you want one story to render logged-in, another logged-out, another as admin — without writing a custom decorator per story.

The solution is a **two-layer provider** wrapped at the preview level + overridable per story via context:

```tsx
// .storybook/mocks/<context-name>.tsx
const DefaultContext = { user: defaultMockUser, url: '/', /* ... */ };
const OverrideContext = React.createContext<Partial<typeof DefaultContext>>({});

export function StorybookOverrideProvider({
  user,
  url,
  children,
}: {
  user?: MockUser | null;
  url?: string;
  children: React.ReactNode;
}) {
  return (
    <OverrideContext.Provider value={{ user, url }}>
      {children}
    </OverrideContext.Provider>
  );
}

// The hook the production code calls — production sees the real implementation;
// Storybook sees this stub via viteFinal alias (see install-wizard.md).
export function useSessionContext() {
  const override = React.useContext(OverrideContext);
  return {
    user: override.user === undefined ? DefaultContext.user : override.user,
    url: override.url ?? DefaultContext.url,
  };
}
```

Per-story usage:

```tsx
import { StorybookOverrideProvider } from '../../../.storybook/mocks/session';

export const TeacherView: Story = {
  decorators: [
    (Story) => (
      <StorybookOverrideProvider user={makeTeacher()}>
        <Story />
      </StorybookOverrideProvider>
    ),
  ],
};

export const LoggedOut: Story = {
  decorators: [
    (Story) => (
      <StorybookOverrideProvider user={null}>
        <Story />
      </StorybookOverrideProvider>
    ),
  ],
};
```

**Why this is non-obvious:** the textbook decorator pattern wraps the same provider with hard-coded values, requiring a separate decorator per story variant. The context-override-provider pattern lets each story declare ONLY the override it needs, falling through to defaults for everything else. Production code reads `useSessionContext()` unchanged.

## Realistic-timing mocks

When prototyping a form / submit / save / load flow, the **timing** matters as much as the data. A submit that completes in 0ms looks broken; one with realistic ~800-1500ms latency demonstrates the loading state designers need to review.

Two patterns:

### Pattern A — MSW handler with `delay()`

```tsx
parameters: {
  msw: {
    handlers: [
      http.post('/auth/login', async () => {
        await delay(800);   // ← visible loading state
        return HttpResponse.json({ user: makeUser() });
      }),
    ],
  },
}
```

### Pattern B — In-mock `setTimeout` (when the mock is a SDK stub, not HTTP)

For SDK stubs like `useForm` (Inertia) that don't go through HTTP, bake the delay into the mock:

```tsx
// .storybook/mocks/inertia-react.tsx — useForm stub
const submit = useCallback((method, url, options) => {
  setProcessing(true);
  setTimeout(() => {
    setProcessing(false);
    options?.onSuccess?.();
    options?.onFinish?.();
  }, 1000);    // ← 1s simulated round-trip
}, [data]);
```

Stories that demo flows (`onSuccess` triggers a redirect, cooldown, post-submit transition) need this delay or the flow is invisible.

**Set delays to match typical production latency** (300-1500ms for HTTP, 200-500ms for SDK methods). Faster than that = invisible loading; slower = stories feel sluggish.

## Router-as-console-logger — making navigation demoable

The classic problem: a story has a button labeled "Go to dashboard." In the real app, this routes; in Storybook with a no-op router, clicking it does nothing — which looks broken and breaks designer trust.

Pattern: stub the router methods to **log what would happen** instead of being silent no-ops:

```tsx
// .storybook/mocks/<router>.tsx
export const router = {
  visit: (url, options) => {
    console.log('[Storybook] router.visit:', url, options);
  },
  replace: (options) => {
    console.log('[Storybook] router.replace:', options);
  },
  get: (url, data, options) => {
    console.log('[Storybook] router.get:', url, data, options);
  },
  // ... post, put, patch, delete, on, off, ...
};
```

The DevTools console becomes the "what would have happened" view. Designers reviewing a flow can confirm "yes, clicking sign-in should navigate to /dashboard" without leaving Storybook.

Same applies to analytics SDKs (Plausible, Mixpanel, Amplitude) — stub each method to log the event name + payload. The story remains visually correct, and the would-be analytics calls are inspectable.

## Anti-patterns specific to story factories

1. **Random data in factory defaults** — see Rule 1
2. **Faker without `faker.seed(1)`** — strings change every run
3. **Factory return type is `any` or `Partial<X>`** — lose the production-type guard; type drift goes undetected
4. **Factories that import the real database / API** — see Rule 3
5. **Importing factories into production component code** — bundler must exclude `src/stories/**`
6. **Per-story `parameters.msw.handlers` duplicating shared handlers** — lift to `preview.tsx` defaults
7. **Defining the same factory in two story files** — extract once the third caller appears; don't wait longer
8. **Hardcoded mock data inline when 3+ stories share a shape** — same rule from the other direction

## Verification record

Rewritten 2026-05-27 — absorbed production lessons (composition, named instances, project-type imports) into project-agnostic guidance; added data-layer adapter patterns for TanStack Query / Inertia / Apollo / SWR / RTK Query. Cut textbook `makeFactory`/`fishery`/`faker` boilerplate that AI knows from training.
