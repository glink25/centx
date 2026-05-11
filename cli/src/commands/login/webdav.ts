import { setCurrentUser, setWebDAVConfig } from "../../runtime/config.ts";
import { printJson } from "../../runtime/output.ts";
import type { ProviderLogin } from "./types.ts";

type WebDAVLoginOpts = {
    url: string;
    username: string;
    password: string;
    proxy?: string;
    customUserName?: string;
};

const validate = async (opts: WebDAVLoginOpts) => {
    // Reuse Cent Web's own checker — issues a PROPFIND against `/` and
    // accepts both 200 and 404 as proof the credentials are good.
    const { checkWebDAVConfig } = await import("@/tidal/web-dav");
    await checkWebDAVConfig({
        remoteUrl: opts.url,
        username: opts.username,
        password: opts.password,
        proxy: opts.proxy,
    });
};

export const webdavLogin: ProviderLogin<WebDAVLoginOpts> = {
    type: "webdav",
    registerFlags: (cmd) =>
        cmd
            .option("--url <url>", "WebDAV remote URL (e.g. https://dav.example/dav/)")
            .option("--username <u>", "WebDAV username")
            .option("--password <p>", "WebDAV password")
            .option("--proxy <url>", "optional CORS / fetch proxy URL")
            .option(
                "--custom-user <name>",
                "display name to disambiguate users sharing one WebDAV account",
            ),
    parseOpts: (raw) => {
        const url = typeof raw.url === "string" ? raw.url : "";
        const username = typeof raw.username === "string" ? raw.username : "";
        const password = typeof raw.password === "string" ? raw.password : "";
        if (!url) throw new Error("missing --url <URL>");
        if (!username) throw new Error("missing --username <U>");
        if (!password) throw new Error("missing --password <P>");
        return {
            url: url.replace(/\/$/, ""),
            username,
            password,
            proxy: typeof raw.proxy === "string" ? raw.proxy : undefined,
            customUserName:
                typeof raw.customUser === "string" ? raw.customUser : undefined,
        };
    },
    run: async (opts) => {
        await validate(opts);
        const display = opts.customUserName || opts.username;
        // Web stores `WebDAVEdit` shape under `web-dav-config`; field name
        // is `remote` (not `url`). Match exactly so a CLI-written config is
        // legible by the Web app and vice versa.
        setWebDAVConfig({
            remote: opts.url,
            username: opts.username,
            password: opts.password,
            proxy: opts.proxy,
            customUserName: opts.customUserName,
        });
        setCurrentUser({ id: display, name: display });
        if (opts.json) {
            printJson({
                ok: true,
                endpoint: "webdav",
                user: { id: display, name: display },
                remote: opts.url,
            });
        } else {
            process.stdout.write(
                `logged in to webdav (${opts.url}) as ${display}\n`,
            );
        }
    },
};
