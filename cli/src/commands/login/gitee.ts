import { setCurrentUser, setGiteeToken } from "../../runtime/config.ts";
import { printJson } from "../../runtime/output.ts";
import type { ProviderLogin } from "./types.ts";

type GiteeLoginOpts = { token: string };

// Gitee v5 user endpoint accepts the access_token as a query string. A
// successful response shape is `{ id, login, ... }` — same fields we need
// from GitHub, so the rest of the CLI's currentUser handling is identical.
const verifyToken = async (
    token: string,
): Promise<{ id: number; login: string }> => {
    const res = await fetch(
        `https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token)}`,
        {
            headers: {
                "User-Agent": "cent-cli",
                Accept: "application/json",
            },
        },
    );
    if (!res.ok) {
        throw new Error(
            `gitee token rejected (${res.status} ${res.statusText})`,
        );
    }
    return res.json() as Promise<{ id: number; login: string }>;
};

export const giteeLogin: ProviderLogin<GiteeLoginOpts> = {
    type: "gitee",
    registerFlags: (cmd) => cmd, // shares --token flag declared by github
    parseOpts: (raw) => {
        const token = typeof raw.token === "string" ? raw.token : "";
        if (!token) throw new Error("missing --token <PAT>");
        return { token };
    },
    run: async ({ token, json }) => {
        const user = await verifyToken(token);
        setGiteeToken(token);
        setCurrentUser({ id: String(user.id), name: user.login });
        if (json) {
            printJson({ ok: true, endpoint: "gitee", user });
        } else {
            process.stdout.write(`logged in to gitee as ${user.login}\n`);
        }
    },
};
