// Per-provider login plugin interface. One file per provider, registered in
// `./index.ts`. Adding a new endpoint = drop a file + one registry line; no
// changes needed to the CLI entry router.

import type cac from "cac";

export type CacInstance = ReturnType<typeof cac>;
export type CacCommand = ReturnType<CacInstance["command"]>;

export type ProviderLogin<TOpts> = {
    type: string;
    // Add the provider's flags onto the shared `login <provider>` command.
    // Returns the same command for chaining (matches cac's API shape).
    registerFlags: (cmd: CacCommand) => CacCommand;
    // Pull the fields this provider cares about out of the merged cli opts
    // bag. Throw with a clear message if a required flag is missing.
    parseOpts: (raw: Record<string, unknown>) => TOpts;
    // Validate credentials against the remote, persist them, print result.
    run: (opts: TOpts & { json?: boolean }) => Promise<void>;
};
