// Convenience wrappers over the localStorage shim so command code reads
// like normal API calls instead of poking globals.
//
// All keys mirror Cent Web's localStorage names verbatim, so a CLI session
// and Web session can read each other's credentials when pointed at the
// same `~/.cent-cli/local-storage.json` (or via `CENT_CLI_HOME` overrides).

const SYNC_ENDPOINT_KEY = "SYNC_ENDPOINT";
const CURRENT_USER_KEY = "cent_cli_user";

const GITHUB_TOKEN_KEY = "github_user_token";
const GITEE_TOKEN_KEY = "gitee_user_token";
const WEBDAV_CONFIG_KEY = "web-dav-config";

export type EndpointType = "github" | "gitee" | "webdav";

export type CliUser = { id: string; name: string };

export type StoredOAuthToken = {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
};

export type StoredWebDAVConfig = {
    remote: string;
    username: string;
    password: string;
    proxy?: string;
    customUserName?: string;
};

const setEndpointType = (type: EndpointType) => {
    localStorage.setItem(SYNC_ENDPOINT_KEY, type);
};

// ─── github ───
export const setGithubToken = (token: string) => {
    setEndpointType("github");
    localStorage.setItem(
        GITHUB_TOKEN_KEY,
        JSON.stringify({ accessToken: token } satisfies StoredOAuthToken),
    );
};

export const getGithubToken = (): StoredOAuthToken | undefined => {
    const raw = localStorage.getItem(GITHUB_TOKEN_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredOAuthToken;
};

// ─── gitee ───
export const setGiteeToken = (token: string) => {
    setEndpointType("gitee");
    localStorage.setItem(
        GITEE_TOKEN_KEY,
        JSON.stringify({ accessToken: token } satisfies StoredOAuthToken),
    );
};

export const getGiteeToken = (): StoredOAuthToken | undefined => {
    const raw = localStorage.getItem(GITEE_TOKEN_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredOAuthToken;
};

// ─── webdav ───
export const setWebDAVConfig = (cfg: StoredWebDAVConfig) => {
    setEndpointType("webdav");
    localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(cfg));
};

export const getWebDAVConfig = (): StoredWebDAVConfig | undefined => {
    const raw = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredWebDAVConfig;
};

// ─── current user (provider-agnostic) ───
export const setCurrentUser = (user: CliUser) => {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
};

export const getCurrentUser = (): CliUser | undefined => {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return undefined;
    try {
        return JSON.parse(raw) as CliUser;
    } catch {
        return undefined;
    }
};

// ─── session ───
export const clearAuth = () => {
    localStorage.removeItem(GITHUB_TOKEN_KEY);
    localStorage.removeItem(GITEE_TOKEN_KEY);
    localStorage.removeItem(WEBDAV_CONFIG_KEY);
    localStorage.removeItem(SYNC_ENDPOINT_KEY);
    localStorage.removeItem(CURRENT_USER_KEY);
};

export const getEndpointType = (): EndpointType | "" => {
    const v = localStorage.getItem(SYNC_ENDPOINT_KEY);
    if (v === "github" || v === "gitee" || v === "webdav") return v;
    return "";
};
