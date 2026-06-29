# Monorepo Configuration

Pyxis is built for monorepos. A single unified index covers every package, app, and service — one query finds a symbol whether it lives in `packages/auth`, `apps/dashboard`, or `services/api`.

---

## Core concepts

Two arrays drive what gets indexed:

- **`CODE_DIRS`** — source directories to parse for code symbols (functions, classes, types). Each entry produces one route per symbol with a `path:line` reference.
- **`SUBPROJECTS`** — human-readable docs, rules, and commands grouped by project. Each entry produces one route per file.

Both arrays feed the same `Pyxis` instance. The `project` label in each entry becomes the `metadata.project` field on every route it produces — which is what the `project:` filter param in `pyxis_search` matches against.

---

## CODE_DIRS

```typescript
const CODE_DIRS = [
  { path: 'packages/auth/src',       project: 'auth',       langs: ['typescript'] },
  { path: 'packages/ui/src',         project: 'ui',         langs: ['typescript'] },
  { path: 'services/api/src',        project: 'api',        langs: ['typescript'] },
  { path: 'services/gateway/src',    project: 'gateway',    langs: ['rust']       },
  { path: 'apps/dashboard/src',      project: 'dashboard',  langs: ['typescript'] },
]
```

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Path relative to workspace root |
| `project` | `string` | Label used in `metadata.project` and the `project:` filter |
| `langs` | `('typescript' \| 'rust')[]` | Which parsers to run |

Entries are processed in parallel — order doesn't matter.

---

## SUBPROJECTS

```typescript
const SUBPROJECTS = [
  {
    name: 'auth',                          // project label
    dirs: [
      { path: 'packages/auth/docs',   type: 'doc'     },
      { path: 'packages/auth/rules',  type: 'rule'    },
    ],
    rootFiles: [
      { path: 'packages/auth/README.md', type: 'doc', name: 'auth-readme' },
      { path: 'packages/auth/AGENTS.md', type: 'doc', name: 'auth-agents' },
    ],
  },
]
```

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Project label — must match what's used in `CODE_DIRS` for the same package |
| `dirs` | `{ path, type }[]` | Directories to recursively scan for `.md`/`.mdc` files |
| `rootFiles` | `{ path, type, name }[]` | Individual files to index as named routes |

`type` for dirs and rootFiles: `'doc'`, `'rule'`, `'command'`

---

## Common monorepo layouts

### packages/* monorepo

```typescript
const CODE_DIRS = [
  { path: 'packages/core/src',     project: 'core',     langs: ['typescript'] },
  { path: 'packages/ui/src',       project: 'ui',       langs: ['typescript'] },
  { path: 'packages/utils/src',    project: 'utils',    langs: ['typescript'] },
]

const SUBPROJECTS = [
  { name: 'core',  dirs: [{ path: 'packages/core/docs',  type: 'doc' }], rootFiles: [] },
  { name: 'ui',    dirs: [{ path: 'packages/ui/docs',    type: 'doc' }], rootFiles: [] },
  { name: 'utils', dirs: [{ path: 'packages/utils/docs', type: 'doc' }], rootFiles: [] },
]
```

### apps + packages

```typescript
const CODE_DIRS = [
  { path: 'apps/web/src',           project: 'web',      langs: ['typescript'] },
  { path: 'apps/mobile/src',        project: 'mobile',   langs: ['typescript'] },
  { path: 'packages/shared/src',    project: 'shared',   langs: ['typescript'] },
]
```

### Turborepo

Same as above — Turborepo doesn't change how source is structured, so the config is identical. Point `path` at each workspace's `src/` directory.

### Mixed TS + Rust (e.g., Tauri)

```typescript
const CODE_DIRS = [
  { path: 'src-tauri/src',          project: 'native',   langs: ['rust']       },
  { path: 'src',                    project: 'web',      langs: ['typescript'] },
]
```

---

## Project label conventions

Project labels are arbitrary strings, but consistency matters — they're what users type in the `project:` filter.

Recommended:
- Use kebab-case: `game-kit`, `voice-core`, `template-amino`
- Use the package name without the scope: `@acme/auth` → `auth`
- Keep labels stable — renaming a project label invalidates existing routes

Avoid:
- Spaces or special characters
- Labels that clash with type names (`doc`, `rule`, `command`, `function`, etc.)

---

## Index file placement

By default pyxis writes to `<cwd>/.lattice/pyxis.json`. You can put it anywhere:

```typescript
const DB_PATH = resolve(ROOT, '.cache/pyxis.json')
// or via env var:
const DB_PATH = process.env.PYXIS_DB ?? resolve(ROOT, '.lattice/pyxis.json')
```

Recommended placement: somewhere in the workspace root, gitignored. The file is large (~40-50MB for 2,700 routes) and should be rebuilt locally or via CI rather than committed.

Add to `.gitignore`:

```
.lattice/pyxis.json
```

---

## Workspace root resolution

Your `index-all.ts` needs a stable reference to the workspace root. Use `import.meta.dirname` (ESM):

```typescript
import { resolve } from 'node:path'
const ROOT = resolve(import.meta.dirname, '..')  // if script is in scripts/
```

Or with `__dirname` (CJS):

```typescript
const ROOT = resolve(__dirname, '..')
```

All paths in `CODE_DIRS` and `SUBPROJECTS` are resolved relative to `ROOT`.

---

## Filtering by project at query time

Once project labels are set, users can narrow results to a single package:

```typescript
// Programmatic
await router.query('authentication', { project: 'auth' })

// Via MCP tool
{ "query": "authentication", "project": "auth" }
```

The `project` filter is applied post-query — Pyxis searches the full index, then drops results where `metadata.project !== project`. For very large indexes, this means all routes are scored before filtering. This is usually fine; if you need true partition-level isolation, run separate `Pyxis` instances with separate index files.
