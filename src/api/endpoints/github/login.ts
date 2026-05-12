import type { Modal } from "@/components/modal";
import { asyncOnce } from "@/utils/async";
import { applyGithubOAuthCallbackUrl } from "./oauth-callback-apply";

// 从环境变量读取 LOGIN_API_HOST
const LOGIN_API_HOST = import.meta.env.VITE_LOGIN_API_HOST;
const APP_OAUTH_CALLBACK_URL = "dailycent://open/oauth-callback";
const LOCAL_TOKEN_KEY = "github_user_token";

const { promise: loginFinished, resolve: resolveLoginFinished } =
    Promise.withResolvers<void>();
console.log("test new code ena");
export const createLoginAPI = () => {
    const login = (_ctx: { modal: Modal }) => {
        void (async () => {
            const redirectUriFallback = APP_OAUTH_CALLBACK_URL;
            const fallbackAuthorizeUrl = `${LOGIN_API_HOST}/api/github-oauth/authorize?redirect_uri=${encodeURIComponent(redirectUriFallback)}`;

            const { runTauriOAuthLoopback } = await import(
                "@/utils/tauri-oauth-loopback"
            );
            const result = await runTauriOAuthLoopback({
                buildAuthorizeUrl: (loopRedirect) => {
                    console.log(
                        `${LOGIN_API_HOST}/api/github-oauth/authorize?redirect_uri=${encodeURIComponent(loopRedirect)}`,
                    );
                    return `${LOGIN_API_HOST}/api/github-oauth/authorize?redirect_uri=${encodeURIComponent(loopRedirect)}`;
                },
                onLoopbackUrl: applyGithubOAuthCallbackUrl,
                fallbackAuthorizeUrl,
            });
            if (result === "success") {
                location.reload();
            }
        })();
    };

    const afterLogin = async () => {
        const resText = localStorage.getItem("_oauth_res");
        if (!resText) {
            resolveLoginFinished();
            return;
        }
        const res = JSON.parse(resText);
        if (res.type !== "github") {
            return;
        }
        localStorage.removeItem("_oauth_res");
        applyGithubOAuthCallbackUrl(res.url);
        resolveLoginFinished();
    };

    const _getToken = async () => {
        await loginFinished;
        const token = getLocalToken();
        if (!token) {
            throw new Error("token not found");
        }
        if (token.expiresIn) {
            const now = Date.now();
            const diff = token.expiresIn - now;
            // 小于2小时 刷新token
            if (diff < 2 * 60 * 60 * 1000) {
                // to refresh
                const res = await fetch(
                    `${LOGIN_API_HOST}/api/github-oauth/refresh-token`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            refreshToken: token.refreshToken,
                        }),
                    },
                );
                if (!res.ok) {
                    throw new Error("refresh token: Bad credentials");
                }
                const githubTokenData =
                    (await res.json()) as GithubTokenResponse;
                const accessToken = githubTokenData["access_token"];
                const expiresIn = githubTokenData["expires_in"];
                const refreshToken = githubTokenData["refresh_token"];
                const refreshTokenExpiresIn =
                    githubTokenData["refresh_token_expires_in"];
                const tokenType = githubTokenData["token_type"];
                const scope = githubTokenData["scope"];
                const newToken = {
                    accessToken,
                    expiresIn: Date.now() + expiresIn * 1000,
                    refreshToken,
                    refreshTokenExpiresIn:
                        Date.now() + refreshTokenExpiresIn * 1000,
                    tokenType,
                    scope,
                };
                if (accessToken) {
                    localStorage.setItem(
                        LOCAL_TOKEN_KEY,
                        JSON.stringify(newToken),
                    );
                    return newToken;
                }
            }
        }
        return token;
    };

    const getToken = asyncOnce(_getToken);

    const manuallySetToken = (token: string) => {
        localStorage.setItem("SYNC_ENDPOINT", "github");
        localStorage.setItem(
            LOCAL_TOKEN_KEY,
            JSON.stringify({
                accessToken: token,
            }),
        );
    };

    const getLocalToken = () => {
        const item = localStorage.getItem(LOCAL_TOKEN_KEY);
        if (!item) {
            return undefined;
        }
        return JSON.parse(item) as Token;
    };

    return {
        login,
        getToken,
        manuallySetToken,
        getLocalToken,
        afterLogin,
    };
};

type GithubTokenResponse = {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_token_expires_in: number;
    scope: string;
    token_type: string;
};

export type Token = {
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    refreshTokenExpiresIn?: number;
};
