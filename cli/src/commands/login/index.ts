import { giteeLogin } from "./gitee.ts";
import { githubLogin } from "./github.ts";
import type { ProviderLogin } from "./types.ts";
import { webdavLogin } from "./webdav.ts";

// Registry of known providers. Adding a new endpoint is a one-line change
// here plus a new file alongside this one — `bin/cent-cli.ts` reads this
// registry and wires both flag-registration and dispatch automatically.
export const PROVIDERS: Record<string, ProviderLogin<any>> = {
    github: githubLogin,
    gitee: giteeLogin,
    webdav: webdavLogin,
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

export type { ProviderLogin } from "./types.ts";
