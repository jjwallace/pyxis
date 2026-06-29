# CI Integration

Running pyxis in CI keeps the index current without relying on every developer to rebuild locally. The index can be cached as a CI artifact and restored on subsequent runs to avoid full reindexes on every push.

---

## Basic GitHub Actions workflow

```yaml
# .github/workflows/pyxis-index.yml
name: Rebuild Pyxis Index

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'packages/**'
      - 'apps/**'
      - 'services/**'
      - 'docs/**'
      - 'scripts/index-all.ts'

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Restore HuggingFace model cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/huggingface
          key: hf-nomic-embed-v1
          restore-keys: hf-

      - name: Restore Pyxis index cache
        id: pyxis-cache
        uses: actions/cache@v4
        with:
          path: .lattice/pyxis.json
          key: pyxis-${{ hashFiles('src/**', 'packages/**', 'scripts/index-all.ts') }}
          restore-keys: pyxis-

      - name: Install pyxis deps
        run: |
          cd repos/pyxis
          bun install
          bun pm trust usearch onnxruntime-node protobufjs
          bun install

      - name: Build index
        if: steps.pyxis-cache.outputs.cache-hit != 'true'
        run: bun run index --full

      - name: Upload index artifact
        uses: actions/upload-artifact@v4
        with:
          name: pyxis-index
          path: .lattice/pyxis.json
          retention-days: 30
```

---

## Scheduled reindex

For indexes that cover frequently changing codebases, add a schedule trigger:

```yaml
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'   # 2am UTC daily
```

---

## Caching strategy

Two caches matter:

### HuggingFace model cache

The Nomic Embed v2 model is ~560MB. Downloading it on every CI run is slow and wastes bandwidth. Cache it by model name — it rarely changes.

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/huggingface
    key: hf-nomic-embed-v1      # update key when changing models
```

### Pyxis index cache

Cache the built index keyed by the hash of source files. On a cache hit, skip the rebuild entirely. On a miss, rebuild and the new index is automatically cached for next run.

```yaml
- uses: actions/cache@v4
  with:
    path: .lattice/pyxis.json
    key: pyxis-${{ hashFiles('src/**', 'packages/**') }}
```

---

## Making the index available to developers

### Option 1: Download from CI artifact

Developers without a local index can download the latest one from CI:

```bash
# Using GitHub CLI
gh run download --name pyxis-index --dir .lattice/

# Or via the GitHub Actions UI: Actions → latest run → Artifacts
```

### Option 2: Upload to object storage

Upload the index to S3/GCS after building and provide a download script:

```yaml
- name: Upload to GCS
  run: gsutil cp .lattice/pyxis.json gs://your-bucket/pyxis/latest.json
  env:
    GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCS_CREDENTIALS }}
```

```bash
# scripts/download-index.sh
gsutil cp gs://your-bucket/pyxis/latest.json .lattice/pyxis.json
echo "Downloaded $(wc -c < .lattice/pyxis.json) bytes"
```

### Option 3: Always build locally

For smaller codebases where full reindex takes <2 minutes, skip the caching complexity and have developers run `bun run index --full` once after cloning:

```bash
# Add to onboarding docs
bun run index:setup   # includes index build
```

---

## Incremental vs full in CI

In CI, always run `--full` unless you're intentionally caching the index between runs:

```yaml
- run: bun run index --full
```

The incremental mode (`bun run index`) assumes an existing index on disk and only updates changed files. In a fresh CI environment, there's no index to start from, so incremental and full are equivalent — but `--full` makes the intent explicit.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PYXIS_DB` | No (defaults to `.lattice/pyxis.json`) | Path where the index is written |
| `HF_HOME` | No (defaults to `~/.cache/huggingface`) | HuggingFace model cache location |
| `HF_ENDPOINT` | No | Mirror URL for HuggingFace CDN (useful behind proxies) |

---

## Verifying the index in CI

Add a smoke test after building:

```yaml
- name: Verify index
  run: |
    COUNT=$(node -e "
      const d = JSON.parse(require('fs').readFileSync('.lattice/pyxis.json', 'utf8'));
      console.log(d.routes?.length ?? 0);
    ")
    echo "Indexed $COUNT routes"
    if [ "$COUNT" -lt 100 ]; then
      echo "ERROR: Index looks too small — expected 100+ routes"
      exit 1
    fi
```
