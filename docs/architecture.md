# Architecture

Pyxis is a three-layer semantic search engine: a fulltext BM25 index, an HNSW vector index, and a hybrid scorer that merges both at query time. Routes (the unit of indexing) are persisted as JSON alongside their embeddings, so the entire index loads from disk in one shot without rebuilding.

---

## Layers

```
                     ┌──────────────┐
                     │   Query text  │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼                           ▼
     ┌────────────────┐         ┌──────────────────┐
     │  Nomic Embed   │         │  BM25 (MiniSearch)│
     │  v2 (ONNX)     │         │  prefix + fuzzy   │
     └───────┬────────┘         └────────┬─────────┘
             │ 768-dim float32           │ normalized score
             ▼                           ▼
     ┌────────────────┐         ┌──────────────────┐
     │  HNSW (usearch)│         │  candidate set    │
     │  cosine metric │         │  (all routes)     │
     └───────┬────────┘         └────────┬─────────┘
             │ top-k by cosine           │
             └──────────┬────────────────┘
                        ▼
              ┌──────────────────┐
              │  Hybrid scorer   │
              │  v*0.7 + f*0.3   │
              └────────┬─────────┘
                       │ sorted, sliced to limit
                       ▼
              ┌──────────────────┐
              │  Route results   │
              │  (no embeddings) │
              └──────────────────┘
```

---

## Route

The atomic unit. Everything indexed is a Route:

```typescript
type Route = {
  type: 'doc' | 'rule' | 'command' | 'function' | 'class' | 'interface' | 'type' | 'struct'
  name: string           // symbol name or doc title
  description: string    // first heading or JSDoc comment
  path: string           // relative file path, or "file.ts:42" for code symbols
  metadata?: {
    project?: string     // which repo this came from
    [key: string]: unknown
  }
}
```

Internally, a stored route also carries `id: number` (monotone) and `embedding: number[]` (float32 array). These are stripped from query results.

---

## Embedding

`createEmbedFn()` wraps `@huggingface/transformers` with a singleton pattern — the ONNX pipeline is loaded once on first call and held in module scope. Subsequent calls return the cached instance.

The text fed to the model is `"${route.name} ${route.description}"`. For queries, the raw query string is embedded directly.

Model defaults: `nomic-ai/nomic-embed-text-v1` → 768 dimensions, mean pooling, normalized. Output is `Array<number>` (float32 values).

---

## Vector Index (HNSW)

Built with [usearch](https://github.com/unum-cloud/usearch) — a native ONNX-friendly HNSW implementation via N-API.

- Metric: cosine similarity
- Scalar: `F32`
- `M` (edges per node): 16
- Distances are converted to similarity: `score = 1 - distance`

The HNSW index is rebuilt in-memory from the routes array on every `init()` call. It is not persisted separately — the JSON is the source of truth, HNSW is always derived from it.

When a type filter is active and the candidate set is smaller than the full route set, HNSW is bypassed (it can only search all routes). Filtered queries fall back to brute-force cosine on the candidate subset.

---

## Fulltext Index (BM25)

Built with [MiniSearch](https://github.com/lucacanali/minisearch).

- Indexed fields: `name`, `description`
- Stored fields: `id` only (routes are looked up by id)
- Search options: `prefix: true`, `fuzzy: 0.2`

BM25 scores are normalized by dividing by the top result's score before merging. This puts them on a roughly [0, 1] scale comparable to cosine similarity.

---

## Hybrid Scoring

```
hybrid_score = vector_score * vectorWeight + bm25_score * fulltextWeight
```

Defaults: `vectorWeight = 0.7`, `fulltextWeight = 0.3`.

The bias toward vector is intentional — semantic paraphrase matching is the primary use case. Fulltext provides a boost for exact symbol names that the model might not surface highly (e.g., searching for a specific method name).

Both weights are configurable at `new Pyxis(embed, { vectorWeight, fulltextWeight })`.

---

## Persistence

The index is stored as a single JSON file:

```json
{
  "version": 2,
  "routes": [
    {
      "id": 0,
      "type": "function",
      "name": "authenticate",
      "description": "Validates a JWT and returns the user session",
      "path": "src/auth.ts:45",
      "metadata": { "project": "api" },
      "embedding": [0.023, -0.041, ...]
    }
  ]
}
```

On `init()`:
1. JSON is read and parsed
2. `routes[]` is loaded into memory
3. MiniSearch is populated with all routes (`fts.addAll`)
4. HNSW index is rebuilt from embeddings (`buildHnsw`)

On `save()`:
1. `JSON.stringify({ version: 2, routes })` is written atomically

The file contains the full embedding vectors. A 2,700-route index at 768 dims is ~45MB.

---

## Incremental Updates

```typescript
router.removeByPath('./docs/auth.md')   // drops from routes[], fts, marks hnsw dirty
await router.addMany(updatedRoutes)     // embeds + adds, rebuilds hnsw once at end
await router.save()
```

`removeByPath` matches by prefix — `removeByPath('src/auth.ts')` removes both `src/auth.ts` and `src/auth.ts:45`, `src/auth.ts:120`, etc. This makes it safe to call before re-indexing an entire file.

`addMany` batches embedding in parallel (`Promise.all`) and defers HNSW rebuild to the end via a dirty flag — avoids rebuilding once per route.

---

## Query Path (step by step)

1. `router.query('JWT middleware', { type: 'function', limit: 8 })`
2. Filter `candidates` to routes where `type === 'function'`
3. Embed `'JWT middleware'` → `Float32Array(768)`
4. Because candidate set ≠ full route set: brute-force cosine over candidates
5. BM25 search `'JWT middleware'` → normalized scores, filter to candidate ids
6. Merge: `score = cosine * 0.7 + bm25 * 0.3`
7. Sort descending, slice to `limit`
8. Strip `embedding` and `id` from returned routes
