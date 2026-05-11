#!/usr/bin/env node
// Pack dist/ into a signed web-bundle zip + write web-latest.json
//
// Inputs (env):
//   TAURI_SIGNING_PRIVATE_KEY            (required) raw text or base64 of minisign secret key file
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD   (optional) password for the key
//   WEB_BUNDLE_DOWNLOAD_URL_BASE         (optional) base URL where the zip will be hosted
//                                        (e.g. https://github.com/glink25/cent-tauri/releases/download/<tag>)
//   MIN_NATIVE_VERSION                   (optional) override min native compat; defaults to current native
//
// Outputs (in ./release-assets/):
//   web-bundle-<webver>.zip
//   web-bundle-<webver>.zip.sig
//   web-latest.json

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "release-assets");

if (!existsSync(DIST)) {
    console.error(`[pack] dist/ not found at ${DIST}. Run \`pnpm build\` first.`);
    process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const tauriConf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));

/** Rust's semver crate requires MAJOR.MINOR.PATCH. Accept "1.5" / "1" too. */
const toSemver = (v) => {
    const parts = String(v).split("-")[0].split(".").map((p) => p.replace(/[^\d]/g, "") || "0");
    while (parts.length < 3) parts.push("0");
    return parts.slice(0, 3).join(".");
};

const webVersion = toSemver(pkg.version);
const nativeVersion = toSemver(tauriConf.version);
const minNative = toSemver(process.env.MIN_NATIVE_VERSION || nativeVersion);

mkdirSync(OUT, { recursive: true });
const zipName = `web-bundle-${webVersion}.zip`;
const zipPath = join(OUT, zipName);
const sigPath = `${zipPath}.sig`;

if (existsSync(zipPath)) rmSync(zipPath);
if (existsSync(sigPath)) rmSync(sigPath);

// Large rarely-changing assets are excluded; the centapp:// asset resolver
// falls back to the embedded dist (shipped with the native installer) for
// any path the active web bundle doesn't contain. If you bump a dependency
// that changes one of these (e.g. jieba-wasm), publish a full `v*` release
// so the embedded copy is refreshed.
const EXCLUDE_GLOBS = ["*.wasm"];
const zipArgs = [
    "-r",
    "-q",
    zipPath,
    ".",
    ...(EXCLUDE_GLOBS.length ? ["-x", ...EXCLUDE_GLOBS] : []),
];
console.log(`[pack] zipping ${DIST} -> ${zipPath} (excluding: ${EXCLUDE_GLOBS.join(", ") || "none"})`);
execFileSync("zip", zipArgs, { cwd: DIST, stdio: "inherit" });

const zipBytes = readFileSync(zipPath);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
console.log(`[pack] sha256 = ${sha256}`);
console.log(`[pack] size   = ${statSync(zipPath).size} bytes`);

const privKeyRaw = process.env.TAURI_SIGNING_PRIVATE_KEY;
if (!privKeyRaw) {
    console.error("[pack] TAURI_SIGNING_PRIVATE_KEY not set");
    process.exit(1);
}
// Allow either raw key file content or base64-wrapped (matches tauri-action conventions).
let privKeyContent = privKeyRaw;
if (!privKeyContent.includes("untrusted comment")) {
    try {
        privKeyContent = Buffer.from(privKeyRaw, "base64").toString("utf8");
    } catch {}
}

const work = mkdtempSync(join(tmpdir(), "cent-pack-"));
const keyPath = join(work, "minisign.key");
writeFileSync(keyPath, privKeyContent);

const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "";
console.log(`[pack] signing ${zipName}`);
// The Tauri CLI signer auto-reads TAURI_SIGNING_PRIVATE_KEY from the env as
// `--private-key`, which conflicts with `--private-key-path`. We've already
// written the key to a file, so strip those env vars from the child process.
const signerEnv = { ...process.env };
delete signerEnv.TAURI_SIGNING_PRIVATE_KEY;
delete signerEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
execFileSync(
    "npx",
    [
        "--yes",
        "@tauri-apps/cli@^2",
        "signer",
        "sign",
        "--private-key-path",
        keyPath,
        "--password",
        password,
        zipPath,
    ],
    { stdio: "inherit", env: signerEnv },
);
rmSync(keyPath);
rmSync(work, { recursive: true, force: true });

const signature = readFileSync(sigPath, "utf8").trim();

const downloadBase =
    process.env.WEB_BUNDLE_DOWNLOAD_URL_BASE ||
    "https://github.com/glink25/cent-tauri/releases/latest/download";
const downloadUrl = `${downloadBase}/${zipName}`;

const manifest = {
    web_version: webVersion,
    min_native_version: minNative,
    built_against_native: nativeVersion,
    url: downloadUrl,
    sha256,
    signature,
    notes: process.env.WEB_BUNDLE_NOTES || "",
};
const manifestPath = join(OUT, "web-latest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("[pack] wrote", manifestPath);
console.log(JSON.stringify(manifest, null, 2));
