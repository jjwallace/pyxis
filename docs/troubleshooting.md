# Troubleshooting

---

## Setup issues

### `bun install` fails with native package errors

```
error: could not determine executable to run for package "onnxruntime-node"
```

**Fix:** Trust the native packages and reinstall:

```bash
bun pm trust usearch onnxruntime-node protobufjs
bun install
```

Bun requires explicit trust before running native addon postinstall scripts.

---

### Model download fails

```
Error: Could not locate file: config.json
```

**Causes:**
- No internet connection on first run
- Corporate proxy or firewall blocking HuggingFace CDN
- Insufficient disk space (~600MB for Nomic Embed v2)

**Fix:**

```bash
# Test HuggingFace connectivity
curl -I https://huggingface.co

# Set a proxy if needed
HF_ENDPOINT=https://your-mirror.example.com bun run index

# Check disk space
df -h ~/.cache/huggingface
```

To use a local/offline model, point `createEmbedFn` at a local path:

```typescript
const embed = await createEmbedFn('./models/nomic-embed-v1')
```

---

### Index file not found on startup

```
[pyxis] Index is empty. Run `bun run index` in the workspace root first.
```

The MCP server started but `PYXIS_DB` points to a file that doesn't exist yet.

**Fix:** Build the index:

```bash
bun run index --full
```

Then verify the path matches what the server expects:

```bash
echo $PYXIS_DB
ls -lh .lattice/pyxis.json
```

---

### `PYXIS_DB` must be an absolute path

The MCP server can start from any working directory. A relative path like `./pyxis.json` resolves relative to wherever the server process starts — which is often not the workspace root.

**Always use absolute paths:**

```bash
claude mcp add pyxis \
  -e PYXIS_DB=/Users/you/workspace/.lattice/pyxis.json \
  -- node /Users/you/workspace/repos/pyxis/dist/mcp-server.js
```

Check what's registered:

```bash
claude mcp list
```

---

## Claude Code issues

### `pyxis_search` not appearing as an available tool

**Checklist:**
1. `claude mcp list` shows pyxis as ✓ Connected (not failed/disconnected)
2. The server was registered with `-s user`, not in `.claude/settings.json` (that field is ignored)
3. You restarted Claude Code after registering the server

**Re-register from scratch:**

```bash
claude mcp remove pyxis -s user 2>/dev/null || true
claude mcp add pyxis -s user \
  -e PYXIS_DB=/absolute/path/to/.lattice/pyxis.json \
  -- node /absolute/path/to/repos/pyxis/dist/mcp-server.js
```

---

### `pyxis_search` appears but always returns no results

```
No results for "auth". Try broadening the query or removing filters.
```

**Causes:**
- The index file is empty or corrupted
- `PYXIS_DB` points to the wrong file
- The `project:` or `type:` filter is too restrictive

**Debug steps:**

```bash
# Check index size
wc -c .lattice/pyxis.json    # should be 30MB+ for a real index

# Check route count
node -e "const d=JSON.parse(require('fs').readFileSync('.lattice/pyxis.json','utf8')); console.log(d.routes?.length)"

# Try without filters
bun run query "authentication"
```

---

### Claude does not call `pyxis_search` automatically

The tool is not auto-triggered on every prompt — Claude decides when to call it based on whether it would help.

To encourage it, ask questions that imply code location unknowns:
- "Where does auth happen?" ✓
- "Find all functions that handle JWT" ✓
- "What does this file do?" ✗ (specific file, no need to search)
- "Explain authentication" ✗ (generic question, doesn't need code lookup)

You can also ask explicitly: *"Use pyxis_search to find where X is implemented."*

---

## MCP server issues

### Server exits immediately on startup

```bash
node repos/pyxis/dist/mcp-server.js
# (exits with no output)
```

This is expected behavior for a stdio MCP server. It waits for JSON-RPC input on stdin. When stdin closes (the terminal ends), the server exits.

To test it manually:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  PYXIS_DB=/path/to/pyxis.json node repos/pyxis/dist/mcp-server.js
```

Expected output:
```json
{"result":{"tools":[{"name":"pyxis_search",...}]},"jsonrpc":"2.0","id":1}
```

---

### Server shows "failed" in `claude mcp list`

The server started but crashed. Common causes:

1. **Missing `mcp-server.js`** — run `bun run build` in `repos/pyxis/`
2. **Wrong node version** — pyxis requires Node 18+
3. **ONNX native addon crash** — run `bun pm trust onnxruntime-node && bun install` in `repos/pyxis/`

Check the MCP server log:

```bash
# Claude Code logs MCP server stderr
# Check: ~/.claude/logs/ or the Claude Code output panel
```

---

## Index issues

### Watch mode misses file changes

Watch mode uses chokidar with `ignoreInitial: true`. Files changed before watch started are not picked up.

**Fix:** Run an incremental index first, then start watch:

```bash
bun run index && bun run index:watch
```

---

### Deleted files still appear in results

The incremental indexer only removes routes for files it re-processes. If a file is deleted and not replaced, its routes remain.

**Fix:** Full reindex:

```bash
bun run index --full
```

---

### Index file grows very large

The index stores all embeddings inline. 768 dimensions × 4 bytes × N routes = ~3KB per route. For 5,000 routes: ~15MB of embeddings, ~45MB total with JSON overhead.

**Options:**
- Reduce `CODE_DIRS` to only the repos you actively query
- Use a smaller embedding model (384 dims → half the size)
- Split into per-project index files and query each separately
