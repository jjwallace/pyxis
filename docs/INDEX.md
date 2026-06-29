# Pyxis Docs

## Core concepts
- [Architecture](architecture.md) — HNSW + BM25 hybrid, embedding pipeline, persistence format, query path
- [Search Modes](search-modes.md) — hybrid vs vector vs fulltext, when to use each, tuning weights
- [Route Types](route-types.md) — type taxonomy, path:line format, metadata schema, custom types
- [Embedding Models](embedding-models.md) — Nomic Embed v2, ONNX runtime, swapping models, mock embeddings

## Indexing
- [Indexing](indexing.md) — full / incremental / watch modes, post-push hooks, keeping the index current
- [Code Parsing](code-parsing.md) — TypeScript Compiler API, Rust regex extraction, what gets indexed and what doesn't
- [Monorepo Config](monorepo-config.md) — CODE_DIRS, SUBPROJECTS, project labels, common monorepo layouts

## Integration
- [MCP Integration](mcp-integration.md) — Claude Code, Cursor, VS Code Copilot, when the tool fires, tool reference
- [CI Integration](ci-integration.md) — GitHub Actions, caching the index, distributing to developers

## Reference
- [Performance](performance.md) — build times, query latency, memory usage, scaling
- [Troubleshooting](troubleshooting.md) — common errors, debug steps, edge cases
