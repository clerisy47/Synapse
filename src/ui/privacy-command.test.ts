// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { createPrivacyCommand } from "./privacy-command";
import { PRIVACY } from "./strings/en";

function setup(clear = vi.fn(async () => {})) {
  const el = document.createElement("div"); const notice = vi.fn(); let close = () => {};
  const command = createPrivacyCommand({ clear, notice, open(mount, onClose) {
    close = () => { unmount(); onClose(); };
    const unmount = mount(el, () => close()); return () => close();
  } });
  return { el, clear, notice, ...command };
}
it("discloses recovery loss and does nothing on cancel", () => {
  const f = setup(); f.command.callback();
  expect(f.el.textContent).toContain("duplicate-prevention");
  const buttons = f.el.querySelectorAll("button"); buttons[1].click();
  expect(f.clear).not.toHaveBeenCalled(); expect(f.el.textContent).toBe("");
});
it("requires the local click, executes once and reports success after disposal", async () => {
  const f = setup(); f.command.callback();
  const button = f.el.querySelector("button")!; button.click(); button.click();
  f.dispose(); await Promise.resolve();
  expect(f.clear).toHaveBeenCalledOnce(); expect(f.notice).toHaveBeenCalledWith(PRIVACY.done);
});
it("reports a generic failure without exception details", async () => {
  const f = setup(vi.fn(async () => { throw new Error("secret note path key"); }));
  f.command.callback(); f.el.querySelector("button")!.click(); await Promise.resolve();
  expect(f.notice).toHaveBeenCalledWith(PRIVACY.failed);
});
it("unload closes confirmation and prevents stale approval", () => {
  const f = setup(); f.command.callback(); const button = f.el.querySelector("button")!;
  f.dispose(); button.click(); expect(f.clear).not.toHaveBeenCalled();
});
