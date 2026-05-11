const LOCAL_TOKEN_KEY = "github_user_token";

/** 从 OAuth 回调 URL 写入 GitHub token（Web / deeplink / 本地回环共用） */
export function applyGithubOAuthCallbackUrl(urlString: string): void {
    const url = new URL(urlString);
    const githubTokenData = JSON.parse(
        url.searchParams.get("github_authorized") ?? "{}",
    );
    const accessToken = githubTokenData["access_token"];
    const expiresIn = githubTokenData["expires_in"];
    const refreshToken = githubTokenData["refresh_token"];
    const refreshTokenExpiresIn = githubTokenData["refresh_token_expires_in"];
    const tokenType = githubTokenData["token_type"];
    const scope = githubTokenData["scope"];

    localStorage.setItem("SYNC_ENDPOINT", "github");

    if (accessToken) {
        localStorage.setItem(
            LOCAL_TOKEN_KEY,
            JSON.stringify({
                accessToken,
                expiresIn: Date.now() + expiresIn,
                refreshToken,
                refreshTokenExpiresIn: Date.now() + refreshTokenExpiresIn,
                tokenType,
                scope,
            }),
        );
    }
}
