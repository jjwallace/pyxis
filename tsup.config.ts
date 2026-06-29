import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    external: ['@huggingface/transformers', 'typescript', 'usearch'],
  },
  {
    entry: ['src/mcp-server.ts'],
    format: ['esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: false,
    external: ['@huggingface/transformers', 'typescript', 'usearch'],
  },
])
