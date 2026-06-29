# Pyxis

![Pyxis](public/title.jpeg)

**Semantic code + doc router built on real embeddings, HNSW vector search, and AST code parsing.**

Named after *Pyxis* — the mariner's compass constellation. Navigate your codebase, docs, rules, and commands by meaning, not keywords.

---

## What makes it different

| | Pyxis | Typical router |
|---|---|---|
| Embeddings | Nomic Embed v2 (MTEB ~62) | MiniLM (MTEB ~56) or hash mocks |
| Code parsing | TypeScript Compiler API + regex (Rust) | TreeSitter |
| Vector search | HNSW via usearch (O log n) | Brute force or trigram |
| Fulltext | BM25 via MiniSearch | None or basic keyword |
| Hybrid scoring | Weighted vector + BM25 merge | Vector only |
| Persistence | JSON on disk, loads instantly | Rebuild from scratch |
| Cross-repo | Single unified index | Per-repo |
| Incremental updates | `removeByPath` + re-add | Full reindex |
| Parallel indexing | `addMany` concurrently | Sequential |

---

## Install

```bash
npm i pyxis @huggingface/transformers
# or
bun add pyxis @huggingface/transformers
```

---

## Usage

```typescript
import { Pyxis, createEmbedFn, indexFiles, indexCode } from 'pyxis'

// Real semantic embeddings — downloads ONNX model once, cached locally
const embed = await createEmbedFn()  // Nomic Embed v2 by default

const router = new Pyxis(embed, {
  dbPath: './pyxis.json',  // persists across restarts
})

await router.init()  // loads existing index from disk if present

// Index docs, rules, and commands
const docs    = await indexFiles('./docs',     { type: 'doc' })
const rules   = await indexFiles('./ai/rules', { type: 'rule' })
await router.addMany([...docs, ...rules])
await router.save()

// Query with natural language
const results = await router.query('how does auth work')
// → [{ route: { type: 'doc', name: 'authentication', path: '...', ... }, score: 0.94 }]

// Filter by type
const rulesOnly = await router.queryRules('code review workflow')
const docsOnly  = await router.queryDocs('asset loading')
const commands  = await router.queryCommands('commit changes')

// Search modes
await router.query('auth', { mode: 'hybrid' })    // default: BM25 + vector
await router.query('auth', { mode: 'vector' })    // pure semantic
await router.query('auth', { mode: 'fulltext' })  // pure BM25
```

### Indexing source code

```typescript
// Extracts functions, classes, interfaces, types, structs
// Each symbol gets its own route with a path:line reference
const code = await indexCode('./src', {
  languages: ['typescript', 'rust'],  // default: all supported
  rootDir: '.',                        // for relative paths
  metadata: { project: 'my-app' },
})

await router.addMany(code)
await router.save()

// Results include path:line so you can jump directly to the symbol
const results = await router.query('JWT authentication middleware')
// → [{ route: { name: 'authenticate', path: 'src/auth.ts:45', ... }, score: 0.94 }]
```

### Incremental updates

```typescript
// On startup — loads existing index instantly, no rebuild
await router.init()

// When a file changes — remove old routes, re-add from updated file
router.removeByPath('./docs/auth.md')
const updated = await indexFiles('./docs/auth.md', { type: 'doc' })
await router.addMany(updated)
await router.save()
```

---

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
| `query(text, options?)` | Hybrid search across all types |
| `queryDocs(text)` | Filter to `type: 'doc'` |
| `queryRules(text)` | Filter to `type: 'rule'` |
| `queryCommands(text)` | Filter to `type: 'command'` |
| `removeByPath(path)` | Drop all routes at a file path |
| `size` | Current route count |

### `createEmbedFn(model?)`

Returns an `EmbedFn` backed by `@huggingface/transformers`. Defaults to `nomic-ai/nomic-embed-text-v1.5`. Downloads once, runs locally, no API key needed.

### `createMockEmbedFn(dimensions?)`

Hash-based deterministic embeddings for testing. No model download. Not semantic — use only in tests.

### `indexFiles(dir, options)`

Recursively scans a directory for `.md`, `.mdc`, `.txt` files. Extracts descriptions from YAML frontmatter or the first heading. Returns `Route[]` ready for `addMany`.

### `indexCode(dir, options)`

Recursively scans a directory for TypeScript, JavaScript, and Rust source files. Uses the TypeScript Compiler API and regex to extract functions, classes, interfaces, types, and structs as individual routes with `path:line` references.

---

## MCP Server

Pyxis ships as an MCP server exposing a single `pyxis_search` tool. Wire it into any MCP-compatible AI assistant and it will search your index on demand — warm across the session, no cold-start per query.

```
You ask a question
  → AI calls pyxis_search("your topic")
  → Server queries the index (BM25 + HNSW, already warm)
  → Returns top N symbols/docs with path:line references
  → AI reads only the specific files it needs
```

### Claude Code

```bash
claude mcp add pyxis \
  -e PYXIS_DB=/absolute/path/to/pyxis.json \
  -- npx pyxis-mcp
```

Stored in `~/.claude.json`, connects on every session. Verify:

```bash
claude mcp list
# pyxis: npx pyxis-mcp - ✓ Connected
```

### Cursor / VS Code Copilot

Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "npx",
      "args": ["pyxis-mcp"],
      "env": {
        "PYXIS_DB": "/absolute/path/to/pyxis.json"
      }
    }
  }
}
```

Restart the IDE and `pyxis_search` appears in the tool list.

> **Note:** `PYXIS_DB` must be an absolute path. The server can start from any working directory.

### Tool reference — `pyxis_search`

| Parameter | Type | Description |
|---|---|---|
| `query` | `string` | Natural language search query (required) |
| `type` | `string` | Filter: `doc`, `rule`, `command`, `function`, `class`, `interface`, `type` |
| `project` | `string` | Filter to a specific project name |
| `limit` | `number` | Results to return (default 8) |
| `mode` | `string` | `hybrid` (default), `vector`, or `fulltext` |

---

## Lattice Setup

Lattice is the Wolf Games monorepo. Pyxis indexes all subprojects into a single unified index at `.lattice/pyxis.json`.

### Quickstart

```bash
cd repos/wolf/Lattice
bun run index:setup
```

Installs deps, builds pyxis, builds the index, and registers the MCP server for Claude Code — all in one step.

### Manual steps

**1. Install and build**

```bash
cd repos/pyxis
bun install
bun pm trust usearch onnxruntime-node protobufjs
bun install
bun run build
cd ../..
```

**2. Build the index**

From the Lattice root:

```bash
bun run index --full
```

**3. Register the MCP server**

```bash
claude mcp add pyxis \
  -e PYXIS_DB="$(pwd)/.lattice/pyxis.json" \
  -- node repos/pyxis/dist/mcp-server.js
```

**4. Verify**

```bash
claude mcp list
# pyxis: node repos/pyxis/dist/mcp-server.js - ✓ Connected

bun run query "how does auth work"
# 10 results (2739 routes indexed)
```

### Keeping the index current

```bash
bun run index          # incremental — only changed files
bun run index --full   # full reindex from scratch
bun run index:watch    # watch mode — auto-updates on file changes
```

The index covers **2,700+ routes** across game-kit, game-components, template-amino, nest (TS + Rust), asset-gen, component-workshop, and pyxis itself — each symbol extracted at the function/class/interface level with line numbers.

---

## Documentation

| Doc | What's in it |
|---|---|
| [Architecture](docs/architecture.md) | HNSW + BM25 hybrid internals, persistence format, query path |
| [MCP Integration](docs/mcp-integration.md) | Claude Code, Cursor, VS Code — setup, verification, tool reference |
| [Indexing](docs/indexing.md) | Full / incremental / watch modes, post-push hooks |
| [Monorepo Config](docs/monorepo-config.md) | CODE_DIRS, SUBPROJECTS, project labels, common layouts |
| [Search Modes](docs/search-modes.md) | Hybrid vs vector vs fulltext, tuning weights |
| [Route Types](docs/route-types.md) | Type taxonomy, path:line format, custom types |
| [Code Parsing](docs/code-parsing.md) | TypeScript Compiler API, Rust regex, what gets extracted |
| [Embedding Models](docs/embedding-models.md) | Nomic Embed v2, ONNX runtime, swapping models |
| [CI Integration](docs/ci-integration.md) | GitHub Actions, index caching, artifact distribution |
| [Performance](docs/performance.md) | Build times, query latency, memory, scaling |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and fixes |

---

## License

MIT
