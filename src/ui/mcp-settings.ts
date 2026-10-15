import type { McpScope, McpServerPort, Disposable } from "../core";
import { MCP_SETTINGS as S } from "./strings/en";
/** Local-only controls. Bearers live only in the mounted, one-time result. */
export function mountMcpSettings(container: HTMLElement, mcp: McpServerPort): Disposable {
    const root = container.ownerDocument.createElement("div");
    root.className = "syn-mcp-settings";
    container.append(root);
    let disposed = false;
    let pending = false;
    let label = "";
    let query = false;
    let submit = false;
    let credential = "";
    let error = false;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
        const node = root.ownerDocument.createElement(tag);
        node.textContent = text;
        return node;
    };
    const run = (fn: () => Promise<void>) => {
        if (pending || disposed)
            return;
        pending = true;
        credential = "";
        error = false;
        paint();
        void fn().catch(() => { error = true; }).finally(() => { pending = false; if (!disposed)
            paint(); });
    };
    const button = (text: string, fn: () => void) => { const b = el("button", text); b.disabled = pending; b.addEventListener("click", fn); root.append(b); };
    const paint = () => {
        if (disposed)
            return;
        root.replaceChildren();
        const status = mcp.status();
        root.append(el("h3", S.title), el("p", S.description), el("p", status.url ?? (status.failed ? S.failed : S.disabled)));
        if (error)
            root.append(el("p", S.failed));
        button(status.enabled ? S.disable : S.enable, () => run(() => status.enabled ? mcp.disable() : mcp.enable()));
        const name = el("label", S.label);
        const input = el("input");
        input.value = label;
        input.disabled = pending;
        input.addEventListener("input", () => { label = input.value; });
        name.append(input);
        root.append(name);
        const scope = (text: string, checked: boolean, change: (v: boolean) => void) => {
            const wrap = el("label", text);
            const check = el("input");
            check.type = "checkbox";
            check.checked = checked;
            check.disabled = pending;
            check.addEventListener("change", () => change(check.checked));
            wrap.append(check);
            root.append(wrap);
        };
        scope(S.query, query, (v) => { query = v; });
        scope(S.submit, submit, (v) => { submit = v; });
        button(S.pair, () => run(async () => {
            const scopes: McpScope[] = [];
            if (query)
                scopes.push("query-vault");
            if (submit)
                scopes.push("submit-research");
            const paired = await mcp.pair(label, scopes);
            if (!disposed)
                credential = paired.token;
            label = "";
            query = false;
            submit = false;
        }));
        if (credential) {
            root.append(el("p", S.once));
            const token = el("input");
            token.readOnly = true;
            token.value = credential;
            token.setAttribute("aria-label", S.token);
            root.append(token);
            button(S.dismiss, () => { credential = ""; paint(); });
        }
        for (const client of status.clients) {
            root.append(el("p", `${client.label} (${client.scopes.join(", ") || S.noScopes})`));
            button(`${S.revoke} ${client.label}`, () => run(() => mcp.revoke(client.id)));
        }
    };
    paint();
    return () => { disposed = true; credential = ""; root.remove(); };
}
