// Lazily instantiate the active SyncEndpoint based on `SYNC_ENDPOINT`.
//
// All commands should call `createActiveEndpoint()` rather than picking a
// specific provider — this is the single seam that routes between
// github / gitee / webdav (and any future endpoint).

import type { SyncEndpoint } from "@/api/endpoints/type";
import modal from "../modal/index.ts";
import {
    type EndpointType,
    getEndpointType,
    getGiteeToken,
    getGithubToken,
    getWebDAVConfig,
} from "./config.ts";

const NO_SESSION =
    "no active session — run `cent-cli login <github|gitee|webdav> ...` first";

const requireAuth = (): EndpointType => {
    const type = getEndpointType();
    if (!type) throw new Error(NO_SESSION);
    switch (type) {
        case "github":
            if (!getGithubToken()?.accessToken) {
                throw new Error(
                    "github token missing — run `cent-cli login github --token <PAT>`",
                );
            }
            return type;
        case "gitee":
            if (!getGiteeToken()?.accessToken) {
                throw new Error(
                    "gitee token missing — run `cent-cli login gitee --token <PAT>`",
                );
            }
            return type;
        case "webdav": {
            const cfg = getWebDAVConfig();
            if (!cfg?.remote || !cfg.username) {
                throw new Error(
                    "webdav config missing — run `cent-cli login webdav --url <URL> --username <U> --password <P>`",
                );
            }
            return type;
        }
    }
};

export const createActiveEndpoint = async (): Promise<SyncEndpoint> => {
    const type = requireAuth();
    // Endpoint init() takes the full @/components/modal Modal which has
    // many methods (webDavAuth / toast / s3Auth …) the CLI's fail-loud stub
    // does not implement. We never reach those code paths in CLI mode (they
    // are gated behind login / inviteForBook / deleteBook flows the CLI
    // either replaces or refuses), so the cast is intentional and load
    // bearing — keeps the modal stub minimal & ensures unintended uses
    // throw at runtime rather than silently no-op.
    const ctx = { modal: modal as unknown as never };
    switch (type) {
        case "github": {
            const { GithubEndpoint } = await import("@/api/endpoints/github");
            return GithubEndpoint.init(ctx);
        }
        case "gitee": {
            const { GiteeEndpoint } = await import("@/api/endpoints/gitee");
            return GiteeEndpoint.init(ctx);
        }
        case "webdav": {
            const { WebDAVEndpoint } = await import(
                "@/api/endpoints/web-dav"
            );
            return WebDAVEndpoint.init(ctx);
        }
    }
};

// Kept for back-compat with existing command imports. New code should use
// `createActiveEndpoint`.
export const createGithubEndpoint = createActiveEndpoint;
export const requireGithubAuth = requireAuth;
