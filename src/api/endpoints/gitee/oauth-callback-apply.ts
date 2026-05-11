const LOCAL_TOKEN_KEY = "gitee_user_token";

/** 从 OAuth 回调 URL 写入 Gitee token（Web / deeplink / 本地回环共用） */
export function applyGiteeOAuthCallbackUrl(urlString: string): void {
    const url = new URL(urlString);
    const tokenData = JSON.parse(
        url.searchParams.get("gitee_authorized") ?? "{}",
    );
    const accessToken = tokenData["access_token"];
    const expiresIn = tokenData["expires_in"];
    const refreshToken = tokenData["refresh_token"];
    const refreshTokenExpiresIn = tokenData["refresh_token_expires_in"];
    const tokenType = tokenData["token_type"];
    const scope = tokenData["scope"];

    localStorage.setItem("SYNC_ENDPOINT", "gitee");

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
