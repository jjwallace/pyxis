# Indexing

Pyxis offers three indexing modes — full rebuild, incremental update, and file-watch — plus a post-push git hook pattern for keeping the index current automatically.

---

## Three modes

### Full rebuild

```bash
bun run index --full    # or: node --import tsx scripts/index-all.ts --full
```

Drops all existing routes and re-embeds everything from scratch. Use after:
- Adding a new repo or source directory to the config
- Changing which file types or directories are indexed
- Suspecting index corruption
- First-time setup

Full rebuilds are slow because every route must be embedded by the ONNX model. For 2,700 routes, expect several minutes.

### Incremental

```bash
bun run index           # or: node --import tsx scripts/index-all.ts
```

For each source path, removes existing routes at that path, then re-adds from the current file contents. Only files that exist in the config are touched — deleted files are not cleaned up automatically (use full rebuild if you've removed files).

Incremental is fast for small changes but still pays the model-load overhead (~5-15s) on every cold start.

### Watch mode

```bash
bun run index:watch
```

Runs chokidar over the `repos/` directory. On any `.ts`, `.tsx`, `.rs`, `.md`, or `.mdc` change:
1. 300ms debounce fires
2. Determines whether it's a code file or doc file
3. For code: re-indexes the entire parent `CODE_DIR` directory (symbol extraction works per-directory)
4. For docs: reads the file, extracts heading, replaces the single route
5. Saves to disk

The model stays warm for the session — per-change cost is embedding only, no reload.

Watch mode is the best option during active development. Run it in a terminal tab or tmux pane.

---

## Post-push git hook

For automatic index updates without remembering to run a command, install a `post-push` hook into each repo. The hook fires in the background after every push, so it never adds latency to your workflow.

```bash
bun run index:hooks     # installs hook into each subproject's .git/hooks/post-push
```

The hook content (baked in at install time with the absolute Lattice path):

```bash
#!/usr/bin/env bash
nohup bun --cwd "/absolute/path/to/workspace" run index > /tmp/pyxis-index.log 2>&1 &
echo "[pyxis] indexing in background → tail /tmp/pyxis-index.log"
```

To check if a rebuild is running:

```bash
tail -f /tmp/pyxis-index.log
```

---

## When the index goes stale

| Scenario | Index state | Fix |
|---|---|---|
| Added a new `.md` doc | Missing that doc | `bun run index` |
| Renamed a function | Old name still indexed | `bun run index` |
| Deleted a file | Dead routes still present | `bun run index --full` |
| Added a new repo to config | New repo not indexed | `bun run index --full` |
| Changed `CODE_DIRS` paths | Wrong paths indexed | `bun run index --full` |
| Watch mode was running | Up to date | — |
| Post-push hook installed | Up to date within ~1 push | — |

---

## Adding a new directory

To start indexing a directory that isn't covered yet, edit your `index-all.ts` (or equivalent) script:

**For source code** — add to `CODE_DIRS`:

```typescript
const CODE_DIRS = [
  // existing entries...
  { path: 'packages/new-service/src', project: 'new-service', langs: ['typescript'] },
]
```

**For docs, rules, or commands** — add to `SUBPROJECTS`:

```typescript
const SUBPROJECTS = [
  // existing entries...
  {
    name: 'new-service',
    dirs: [
      { path: 'packages/new-service/docs', type: 'doc' },
      { path: 'packages/new-service/ai/rules', type: 'rule' },
    ],
    rootFiles: [
      { path: 'packages/new-service/README.md', type: 'doc', name: 'new-service-readme' },
    ],
  },
]
```

Then run `bun run index --full` to pick up the new configuration.

---

## Index file location

The default location is `<cwd>/.lattice/pyxis.json` (relative to where the indexer runs). Override with:

```bash
PYXIS_DB=/custom/path/pyxis.json bun run index
```

The MCP server reads the same env var at startup. Both the indexer and the server must point to the same file.

---

## Index file size

A 768-dimension float32 embedding is 768 × 4 = 3,072 bytes. For 2,700 routes, the embeddings alone are ~8MB. With JSON overhead, typical size is 40-50MB.

If the file is too large to commit or distribute:
- Store it in `.gitignore` and rebuild on each developer's machine
- Use a CI artifact (see [ci-integration.md](ci-integration.md))
- Reduce coverage: index only the repos that matter for your workflow
