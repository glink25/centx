// Replacement for the `uuid` package, aliased via tsup config so that any
// `import { v4 } from "uuid"` in the reused Cent Web sources (e.g.
// `src/database/stash.ts`) resolves here.
//
// We do NOT depend on the npm `uuid` package in the CLI bundle — Node 18+
// ships `crypto.randomUUID()` natively, which is RFC 4122 v4 compatible
// (cryptographically secure, identical surface for our needs). Aliasing
// makes that swap explicit and avoids accidentally pulling `uuid` from the
// parent workspace's node_modules.
//
// Only the surface actually used by reused Cent Web code is exported.
// If you find a NEW `uuid` API used by a code path the CLI bundles in, add
// it here rather than depending on the npm package.

import { randomUUID } from "node:crypto";

export const v4 = (): string => randomUUID();
export default { v4 };
