// CLI modal stub. The CLI is non-interactive: any code path that needs a
// real modal prompt is unsupported here. Methods throw or no-op so static
// reuse of @/api/endpoints/* keeps working as long as Phase-1 commands
// don't trigger them.

const unsupported = (method: string) => () => {
    throw new Error(
        `[cent-cli] modal.${method}() is not supported in CLI mode. This means the command path requires interactive input that should be exposed as a flag instead.`,
    );
};

export type Modal = {
    prompt: (...args: any[]) => any;
    alert: (...args: any[]) => any;
    confirm: (...args: any[]) => any;
    show: (...args: any[]) => any;
    close: (...args: any[]) => any;
    loading: (...args: any[]) => any;
};

const modal: Modal = {
    prompt: unsupported("prompt"),
    alert: unsupported("alert"),
    confirm: unsupported("confirm"),
    show: unsupported("show"),
    close: () => {},
    loading: <T,>(p: Promise<T>) => p,
};

export default modal;
