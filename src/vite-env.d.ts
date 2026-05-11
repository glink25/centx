/// <reference types="vite/client" />
/// <reference types="unplugin-info/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module "jieba-rs-wasm-bg?url" {
    const url: string;
    export default url;
}

// node-forge 子模块类型声明（用于按需导入）
declare module "node-forge/lib/forge" {
    const forge: unknown;
    export default forge;
}

declare module "node-forge/lib/rsa" {
    const rsa: {
        generateKeyPair: (bits: number) => {
            publicKey: unknown;
            privateKey: unknown;
        };
    };
    export default rsa;
}

declare module "node-forge/lib/pki" {
    const pki: {
        publicKeyToPem: (key: unknown) => string;
        privateKeyToPem: (key: unknown) => string;
        privateKeyFromPem: (pem: string) => {
            decrypt: (
                data: string,
                scheme: string,
                options?: { md: unknown },
            ) => string;
        };
    };
    export default pki;
}

declare module "node-forge/lib/util" {
    const util: {
        decode64: (base64: string) => string;
    };
    export default util;
}

declare module "node-forge/lib/md" {
    const md: {
        sha256: {
            create: () => unknown;
        };
    };
    export default md;
}

interface ImportMetaEnv {
    /** 桌面 OAuth 本地回环优先绑定的端口（需在 LOGIN_API / OAuth 应用登记对应 redirect_uri） */
    readonly VITE_OAUTH_LOOPBACK_PORT?: string;
}
