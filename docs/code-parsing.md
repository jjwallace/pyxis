# Code Parsing

`indexCode` extracts symbol-level routes from TypeScript and Rust source files. Each function, class, interface, type alias, or struct becomes a separate route with a `path:line` reference.

---

## TypeScript / JavaScript

Uses the **TypeScript Compiler API** — the same parser the TypeScript compiler itself uses. This gives accurate symbol extraction across complex files with generics, decorators, and module re-exports.

### Extracted symbols

| Symbol | Route type | Example |
|---|---|---|
| `function foo()` | `function` | Named function declarations |
| `export const foo = () =>` | `function` | Exported arrow function constants |
| `class Foo` | `class` | Class declarations |
| `interface Foo` | `interface` | Interface declarations |
| `type Foo =` | `type` | Type alias declarations |

### Description extraction

For each symbol, pyxis looks for a JSDoc comment immediately preceding the node:

```typescript
/**
 * Validates a JWT token and returns the decoded user session.
 * Throws AuthError if the token is expired or invalid.
 */
export function authenticate(token: string): UserSession { ... }
```

→ `description: "Validates a JWT token and returns the decoded user session."`

If no JSDoc is present, the description is left as the symbol name.

### Line numbers

Line numbers are extracted from `node.getStart()` via the TypeScript source file — they represent the first line of the symbol declaration.

### What is NOT extracted

- Re-exports: `export { foo } from './foo'` — the symbol is indexed in its source file
- Default exports: `export default function()` without a name
- Dynamic exports: `module.exports = { ... }`
- Overloaded function signatures (only the implementation is indexed)
- Private class members
- Symbols inside function bodies

---

## Rust

Uses **regex-based extraction** rather than a full AST parser. This covers the common cases accurately but has limitations with complex macro-heavy code.

### Extracted symbols

| Pattern | Route type | Example |
|---|---|---|
| `pub fn foo(` | `function` | Public functions |
| `fn foo(` | `function` | Private functions |
| `pub struct Foo` | `struct` | Public structs |
| `struct Foo` | `struct` | Private structs |
| `pub enum Foo` | (as `type`) | Enums |
| `pub trait Foo` | (as `interface`) | Traits |

### Description extraction

Doc comments (`///` and `/** */`) immediately before the symbol:

```rust
/// Decodes a JWT token from the Authorization header.
/// Returns None if the header is missing or malformed.
pub fn extract_bearer(headers: &HeaderMap) -> Option<String> { ... }
```

→ `description: "Decodes a JWT token from the Authorization header."`

### Limitations

- Attribute macros (`#[derive(...)]`, `#[tokio::main]`) are not parsed
- `impl` blocks are not indexed as routes; the methods inside them are
- Macro-generated functions (`macro_rules!`) are not extracted
- Complex pattern matching in `match` arms is ignored

---

## Usage

```typescript
import { indexCode } from 'pyxis'

const symbols = await indexCode('./src', {
  languages: ['typescript', 'rust'],   // default: all supported
  rootDir: '.',                         // for computing relative paths
  metadata: { project: 'my-app' },     // merged into every route's metadata
})

// symbols: Route[]
// [
//   { type: 'function', name: 'authenticate', path: 'src/auth.ts:45', ... },
//   { type: 'interface', name: 'UserSession', path: 'src/types.ts:12', ... },
//   ...
// ]
```

### Options

| Option | Default | Description |
|---|---|---|
| `languages` | `['typescript', 'rust']` | Which parsers to run |
| `rootDir` | `'.'` | Workspace root — paths are computed relative to this |
| `metadata` | `{}` | Merged into `metadata` on every route |

### Path format

All route paths are relative to `rootDir`:

```
rootDir: '/workspace'
file: '/workspace/packages/auth/src/middleware.ts'
→ path: 'packages/auth/src/middleware.ts:45'
```

---

## Extending to new languages

The code indexer exports a `CodeIndexer` interface. To add a new language:

1. Write an extractor function that takes a file path and returns `Route[]`
2. Add it to the `indexCode` language dispatch table
3. Submit a PR

The TypeScript extractor (`src/code-indexer.ts`) is the reference implementation. The Rust extractor demonstrates how to do it with regex when a full AST parser isn't available.

---

## Performance

TypeScript Compiler API is the bottleneck for large files. Complex files with many generics or deep type inference can take 50-200ms to parse. The indexer processes all files in a directory in parallel (`Promise.all`), so wall-clock time is bounded by the slowest file, not the sum.

For 2,700 routes across ~300 source files, indexing takes 30-90 seconds depending on machine speed and whether the TypeScript program cache is warm.
