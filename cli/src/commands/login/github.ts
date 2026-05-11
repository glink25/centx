import { setCurrentUser, setGithubToken } from "../../runtime/config.ts";
import { printJson } from "../../runtime/output.ts";
import type { ProviderLogin } from "./types.ts";

type GithubLoginOpts = { token: string };

const verifyToken = async (
    token: string,
): Promise<{ id: number; login: string }> => {
    const res = await fetch("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "cent-cli",
            Accept: "application/vnd.github+json",
        },
    });
    if (!res.ok) {
        throw new Error(
            `github token rejected (${res.status} ${res.statusText})`,
        );
    }
    return res.json() as Promise<{ id: number; login: string }>;
};

export const githubLogin: ProviderLogin<GithubLoginOpts> = {
    type: "github",
    registerFlags: (cmd) => cmd.option("--token <token>", "github PAT"),
    parseOpts: (raw) => {
        const token = typeof raw.token === "string" ? raw.token : "";
        if (!token) throw new Error("missing --token <PAT>");
        return { token };
    },
    run: async ({ token, json }) => {
        const user = await verifyToken(token);
        setGithubToken(token);
        setCurrentUser({ id: String(user.id), name: user.login });
        if (json) {
            printJson({ ok: true, endpoint: "github", user });
        } else {
            process.stdout.write(`logged in to github as ${user.login}\n`);
        }
    },
};
