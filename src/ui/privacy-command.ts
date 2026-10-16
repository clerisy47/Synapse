import type { Disposable } from "../core";
import { PRIVACY } from "./strings/en";

export function createPrivacyCommand(deps: {
  clear(): Promise<void>;
  open(mount: (el: HTMLElement, close: Disposable) => Disposable, onClose: Disposable): Disposable;
  notice(message: string): void;
}) {
  let disposed = false;
  let closing: Disposable | null = null;
  let busy = false;
  return {
    command: { id: "clear-plugin-data", name: PRIVACY.command, callback() {
      if (disposed || closing || busy) return;
      closing = deps.open((el, close) => {
        const doc = el.ownerDocument;
        const message = doc.createElement("p"); message.textContent = PRIVACY.warning; el.append(message);
        const confirm = doc.createElement("button"); confirm.textContent = PRIVACY.confirm; el.append(confirm);
        const cancel = doc.createElement("button"); cancel.textContent = PRIVACY.cancel; el.append(cancel);
        cancel.addEventListener("click", close);
        confirm.addEventListener("click", () => {
          if (disposed || busy) return;
          busy = true; confirm.disabled = true; close();
          void deps.clear().then(() => deps.notice(PRIVACY.done), () => deps.notice(PRIVACY.failed));
        });
        return () => el.replaceChildren();
      }, () => { closing = null; });
    } },
    dispose() { disposed = true; closing?.(); closing = null; },
  };
}
