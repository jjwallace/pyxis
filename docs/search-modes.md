# Search Modes

Pyxis supports three search modes that control how the query is matched against the index. The default (`hybrid`) is appropriate for most use cases. The others exist for specific scenarios where you want to bias toward semantic meaning or exact keyword matches.

---

## Hybrid (default)

```typescript
await router.query('JWT authentication middleware')
// equivalent to:
await router.query('JWT authentication middleware', { mode: 'hybrid' })
```

Combines vector similarity and BM25 fulltext:

```
score = cosine_similarity * 0.7 + bm25_normalized * 0.3
```

**Best for:** Most queries. Works well for both natural language descriptions (*"how does session management work"*) and partial symbol names (*"sessionManager"*).

**Tradeoff:** Neither purely semantic nor purely keyword-based. A very exact symbol name query might score lower than expected if the BM25 match is overwhelmed by the vector component.

---

## Vector

```typescript
await router.query('stores user login state', { mode: 'vector' })
```

Uses only HNSW cosine similarity. BM25 is skipped entirely.

**Best for:**
- Paraphrase queries: *"stores user login state"* → finds `SessionStore`, `AuthContext`, `UserCredentials`
- Conceptual queries with no shared vocabulary: *"handles errors gracefully"* → finds error boundary components
- Cross-language queries: describing a concept in plain English to find it in an unfamiliar codebase

**Tradeoff:** Exact symbol names with no semantic neighbors may score poorly. *"authenticate"* as a vector query will find conceptually related things but might not surface the literal `authenticate` function as the top result.

---

## Fulltext

```typescript
await router.query('createSession', { mode: 'fulltext' })
```

Uses only BM25 (MiniSearch). Vector search is skipped — no embedding call.

**Best for:**
- Exact or near-exact symbol name lookup: `"createSession"`, `"handleWebSocketMessage"`
- Prefix searches: `"auth"` → matches `authenticate`, `authorization`, `AuthProvider`
- Fast searches where semantic understanding isn't needed (no ONNX call)
- Debugging: verify a symbol is indexed by its exact name

**Tradeoff:** No semantic understanding. *"user login"* will not find `SessionStore` unless "user" or "login" appears in its name or description.

---

## Adjusting hybrid weights

If your use case consistently benefits from more or less semantic weight, tune the defaults at construction:

```typescript
const router = new Pyxis(embed, {
  vectorWeight: 0.5,    // more balanced
  fulltextWeight: 0.5,
})

// or heavily semantic — for conceptual codebases with long descriptions
const router = new Pyxis(embed, {
  vectorWeight: 0.9,
  fulltextWeight: 0.1,
})
```

Weights don't need to sum to 1.0, but results are easier to interpret when they do.

---

## Combining with type and project filters

Filters are applied before scoring, narrowing the candidate pool. Mode applies to scoring within that pool.

```typescript
// BM25 over only functions in the auth project
await router.query('session', {
  mode: 'fulltext',
  type: 'function',
  project: 'auth',
})
```

Note: when a `type` filter reduces the candidate pool below the full route set, HNSW is bypassed in favor of brute-force cosine (HNSW can only search the full index). This is transparent to the caller — results are identical, just slightly slower for very large indexes.

---

## Choosing a mode

| Query shape | Recommended mode |
|---|---|
| Natural language question | `hybrid` |
| Partial or full symbol name | `hybrid` or `fulltext` |
| Conceptual paraphrase | `vector` |
| Cross-language / non-English | `vector` |
| Performance-sensitive, no semantic needed | `fulltext` |
| Debugging index coverage | `fulltext` |

When in doubt, use `hybrid`. It outperforms either pure mode on the majority of real-world queries.
