# Route Types

Every entry in the Pyxis index has a `type` field that classifies what kind of thing it is. Types are used for display, for filtering (`type:` param), and for understanding what `path` means.

---

## Type taxonomy

### Document types (from `indexFiles`)

| Type | Source | Description |
|---|---|---|
| `doc` | `.md`, `.mdc` files in doc directories | Architecture notes, guides, references, READMEs |
| `rule` | `.md`, `.mdc` files in rules directories | Coding standards, guardrails, conventions |
| `command` | `.md`, `.mdc` files in command directories | Runnable slash commands or AI agent commands |

`path` for these is the file path relative to the workspace root, e.g., `packages/auth/docs/sessions.md`.

### Code symbol types (from `indexCode`)

| Type | Language | Description |
|---|---|---|
| `function` | TypeScript, JavaScript, Rust | Named functions, arrow function exports |
| `class` | TypeScript, JavaScript | Class declarations |
| `interface` | TypeScript | Interface declarations |
| `type` | TypeScript | Type alias declarations |
| `struct` | Rust | Struct definitions |

`path` for code symbols includes the line number: `src/auth/middleware.ts:45`. This lets you jump directly to the definition.

---

## The `path` field

Doc routes:
```
packages/auth/docs/sessions.md
repos/game-kit/ai/rules/no-dom.md
```

Code symbol routes:
```
src/auth/middleware.ts:45
repos/nest/voice-core/src/tts.rs:120
```

The colon-separated line number is appended by the code indexer. `removeByPath('src/auth.ts')` matches all routes whose path starts with `src/auth.ts` — so `src/auth.ts:45`, `src/auth.ts:120`, etc. are all removed.

---

## The `metadata` field

```typescript
type Route = {
  // ...
  metadata?: {
    project?: string      // which repo/package this came from
    [key: string]: unknown
  }
}
```

`metadata.project` is the primary metadata field. It's set by the indexer for every route and is what the `project:` filter param matches.

You can add arbitrary metadata to custom routes:

```typescript
await router.add({
  type: 'doc',
  name: 'auth-sessions',
  description: 'How session tokens are stored and validated',
  path: 'packages/auth/docs/sessions.md',
  metadata: {
    project: 'auth',
    author: 'alice',
    lastUpdated: '2024-01-15',
    audience: 'backend',
  },
})
```

Metadata is stored verbatim and returned in results but not indexed or searchable.

---

## Adding custom types

The `type` field is `string`, not an enum — you can use any value:

```typescript
await router.addMany([
  { type: 'schema', name: 'UserSchema', description: 'Zod schema for user records', path: 'src/schemas/user.ts:5', metadata: { project: 'api' } },
  { type: 'migration', name: '0042_add_sessions', description: 'Adds sessions table', path: 'db/migrations/0042.sql', metadata: { project: 'db' } },
  { type: 'test', name: 'authenticate.test', description: 'Tests for auth middleware', path: 'src/auth/middleware.test.ts', metadata: { project: 'api' } },
])
```

Custom types are filterable: `router.query('session schema', { type: 'schema' })`.

The MCP tool's `type` input schema enumerates known values but accepts any string — the server doesn't validate it.

---

## Querying by type

```typescript
// Convenience methods (filter to built-in types)
await router.queryDocs('authentication')
await router.queryRules('no DOM in games')
await router.queryCommands('commit workflow')

// Generic filter (works for any type string)
await router.query('session', { type: 'function' })
await router.query('user record', { type: 'schema' })

// MCP tool
{ "query": "session management", "type": "function" }
```

---

## Inspecting the index

To see what types and projects are in the index:

```typescript
const routes = router['routes']  // internal array (not public API)
const byType: Record<string, number> = {}
for (const r of routes) byType[r.type] = (byType[r.type] ?? 0) + 1
console.log(byType)
// { function: 1840, class: 210, interface: 380, type: 120, doc: 89, rule: 12, command: 8, struct: 80 }
```

Or via the CLI query script:

```bash
bun run query "auth" --type function
```
