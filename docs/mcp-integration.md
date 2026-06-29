# MCP Integration

Pyxis exposes a single MCP tool — `pyxis_search` — that lets any MCP-compatible AI assistant search your indexed codebase by meaning. The server is a lightweight stdio wrapper around the same `Pyxis` class used in the library.

---

## How it works

```
You ask a question
  → AI decides to call pyxis_search("your topic")
  → Server loads the index (once, on first tool call)
  → Returns top N hits with file paths and line numbers
  → AI reads only the specific files it needs
```

The model load (ONNX, ~5-15s) happens on the **first tool call** in a session, not on server start. After that, the server is warm for the rest of the session. It does not reload between calls.

---

## Tool auto-invocation

`pyxis_search` is **not** called automatically on every prompt. The AI decides to call it based on:

- The tool description (shown to the model on connection)
- Whether the question seems to require code location knowledge
- The AI's assessment of what tools would help

The tool description reads: *"Search the codebase index by meaning. Returns matching symbols, docs, rules, and commands with file paths and line numbers. Use this before reading files to find where relevant code lives across repos."*

To encourage the AI to use it, phrase questions that imply code location unknowns: *"where does auth happen?"*, *"find all places that load assets"*, *"which module handles session tokens?"*

---

## Claude Code

### Register (user scope — persists across all sessions)

```bash
claude mcp add pyxis \
  -s user \
  -e PYXIS_DB=/absolute/path/to/pyxis.json \
  -- node /absolute/path/to/repos/pyxis/dist/mcp-server.js
```

The `-s user` flag writes to `~/.claude.json`, not the project's `.claude/settings.json`. This is important — project settings do not support `mcpServers` and the field is silently ignored there.

### Register (project scope — shared via `.mcp.json`)

Add `.mcp.json` to your project root and commit it:

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/absolute/path/to/repos/pyxis/dist/mcp-server.js"],
      "env": {
        "PYXIS_DB": "/absolute/path/to/pyxis.json"
      }
    }
  }
}
```

Claude Code picks up `.mcp.json` automatically when present in the workspace root.

### Verify

```bash
claude mcp list
# pyxis: node .../mcp-server.js  ✓ Connected
```

If the server shows "failed" or "disconnected", check:
1. The `PYXIS_DB` path is absolute and the file exists (`ls -lh /path/to/pyxis.json`)
2. The `mcp-server.js` path is absolute and built (`ls repos/pyxis/dist/mcp-server.js`)
3. `node` is on PATH in the shell Claude Code uses

### Remove / update

```bash
claude mcp remove pyxis -s user
claude mcp add pyxis -s user -e PYXIS_DB=... -- node ...
```

---

## Cursor

Add `.mcp.json` to the project root (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/absolute/path/to/repos/pyxis/dist/mcp-server.js"],
      "env": {
        "PYXIS_DB": "/absolute/path/to/pyxis.json"
      }
    }
  }
}
```

Restart Cursor. The tool appears in the composer's tool list.

---

## VS Code Copilot

Add `.mcp.json` to the project root:

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/absolute/path/to/repos/pyxis/dist/mcp-server.js"],
      "env": {
        "PYXIS_DB": "/absolute/path/to/pyxis.json"
      }
    }
  }
}
```

Enable MCP in VS Code settings: `"github.copilot.chat.experimental.mcp.enabled": true`. Restart the window.

---

## Using `npx` instead of `node`

If `pyxis` is published to a registry, you can use `npx` to avoid an absolute path to the built server:

```bash
claude mcp add pyxis \
  -e PYXIS_DB=/absolute/path/to/pyxis.json \
  -- npx pyxis-mcp
```

This works once `pyxis` ships a `pyxis-mcp` binary in its `bin` field.

---

## Tool reference

### `pyxis_search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | `string` | required | Natural language search query |
| `type` | `string` | — | Filter: `doc`, `rule`, `command`, `function`, `class`, `interface`, `type` |
| `project` | `string` | — | Filter to a specific project label |
| `limit` | `number` | `8` | Max results to return |
| `mode` | `string` | `hybrid` | `hybrid`, `vector`, or `fulltext` |

### Example tool calls

```json
{ "query": "JWT authentication middleware" }
{ "query": "asset loading", "type": "function", "project": "game-kit" }
{ "query": "post-process effects", "limit": 15, "mode": "vector" }
{ "query": "createSession", "mode": "fulltext" }
```

### Response format

```
Pyxis: "JWT middleware" → 5 hits (2739 indexed)

1. [0.91] function · api — authenticate
   src/auth/middleware.ts:45
   Validates a JWT token and returns the user session

2. [0.87] function · api — verifyToken
   src/auth/jwt.ts:12
   Decodes and verifies a signed JWT string
...
```

Each hit includes:
- Hybrid score `[0.00–1.00]`
- Route type and project label
- Symbol or doc name
- File path (with `:line` for code symbols)
- Description (first heading or JSDoc)

---

## Session lifecycle

```
Session start
  → Claude Code connects to pyxis MCP server (stdio)
  → Server process starts, declares tools (no index load yet)

First pyxis_search call
  → createEmbedFn() — loads Nomic Embed v2 ONNX model (~5-15s)
  → router.init() — reads pyxis.json, rebuilds HNSW + BM25 in memory

Subsequent calls
  → Model and index already warm — typical query <100ms

Session end
  → Claude Code closes stdin → server process exits cleanly
```

The model and index stay resident for the entire session. There is no per-call overhead after warm-up.
