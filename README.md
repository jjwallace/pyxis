# Pyxis

**Semantic router built on real embeddings + hybrid BM25/vector search.**

Named after *Pyxis* — the mariner's compass constellation. Navigate your docs, rules, and commands by meaning, not keywords.

## What makes it different

| | Pyxis | Typical semantic router |
|---|---|---|
| Embeddings | Nomic Embed v2 (MTEB ~62) | all-MiniLM-L6-v2 (MTEB ~56) or hash mocks |
| Fulltext | BM25 via MiniSearch | None or basic keyword |
| Hybrid scoring | Weighted vector + BM25 merge | Vector only |
| Persistence | JSON on disk, loads instantly | Rebuild from scratch each run |
| Incremental updates | `removeByPath` + re-add | Full reindex |
| Parallel indexing | `addMany` embeds concurrently | Sequential |

## Install

```bash
npm i pyxis @huggingface/transformers
# or
bun add pyxis @huggingface/transformers
```

## Usage

```typescript
import { Pyxis, createEmbedFn, indexFiles } from 'pyxis'

// Real semantic embeddings — downloads ONNX model once, cached locally
const embed = await createEmbedFn()  // Nomic Embed v2 by default

const router = new Pyxis(embed, {
  dbPath: './pyxis.json',  // persists across restarts
})

await router.init()  // loads existing index from disk if present

// Index a directory of docs
const docs = await indexFiles('./docs', { type: 'doc' })
const rules = await indexFiles('./ai/rules', { type: 'rule' })
await router.addMany([...docs, ...rules])
await router.save()

// Query with natural language
const results = await router.query('how does auth work')
// → [{ route: { type: 'doc', name: 'authentication', ... }, score: 0.94 }, ...]

// Filter by type
const rulesOnly = await router.queryRules('code review workflow')
const docsOnly  = await router.queryDocs('asset loading')
const commands  = await router.queryCommands('commit changes')

// Search modes
await router.query('auth', { mode: 'hybrid' })    // default: BM25 + vector
await router.query('auth', { mode: 'vector' })    // pure semantic
await router.query('auth', { mode: 'fulltext' })  // pure BM25
```

## Persistent index + incremental updates

```typescript
// On startup — loads existing index instantly, no rebuild
await router.init()

// When a file changes — remove old routes, re-add from updated file
router.removeByPath('./docs/auth.md')
const updated = await indexFiles('./docs/auth.md', { type: 'doc' })
await router.addMany(updated)
await router.save()
```

## API

### `new Pyxis(embedFn, config?)`

| Option | Default | Description |
|---|---|---|
| `dbPath` | `'./pyxis.json'` | Where to persist the index |
| `defaultLimit` | `5` | Results per query |
| `vectorWeight` | `0.7` | Hybrid score weight for vector similarity |
| `fulltextWeight` | `0.3` | Hybrid score weight for BM25 |

### Methods

| Method | Description |
|---|---|
| `init()` | Load persisted index from `dbPath` |
| `save()` | Write current index to `dbPath` |
| `add(route)` | Add one route (embeds immediately) |
| `addMany(routes)` | Add many routes (parallel embedding) |
| `query(text, options?)` | Hybrid search |
| `queryDocs(text)` | Filter to `type: 'doc'` |
| `queryRules(text)` | Filter to `type: 'rule'` |
| `queryCommands(text)` | Filter to `type: 'command'` |
| `removeByPath(path)` | Drop all routes at a file path |
| `size` | Current route count |

### `createEmbedFn(model?)`

Returns an `EmbedFn` backed by `@huggingface/transformers`. Defaults to `nomic-ai/nomic-embed-text-v1`. Downloads once, runs locally, no API key.

### `createMockEmbedFn(dimensions?)`

Hash-based deterministic embeddings for testing. No model download. Not semantic — use only in tests.

### `indexFiles(dir, options)`

Recursively scans a directory for `.md`, `.mdc`, `.txt` files. Extracts descriptions from YAML frontmatter or the first heading. Returns `Route[]` ready for `addMany`.

## License

MIT
