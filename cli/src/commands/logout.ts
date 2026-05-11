import { clearAuth } from "../runtime/config.ts";
import { printJson } from "../runtime/output.ts";

export const logout = async (opts: { json?: boolean }) => {
    clearAuth();
    if (opts.json) printJson({ ok: true });
    else process.stdout.write("logged out\n");
};
