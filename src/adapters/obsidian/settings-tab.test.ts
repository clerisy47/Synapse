/**
 * Obsidian settings host unit tests (M1-T16).
 */

import { describe, expect, it, vi } from "vitest";

import {
  createObsidianSettingsHost,
  type SettingLike,
  type TextComponentLike,
} from "./settings-tab";

type Recorded = {
  warnings: Array<{ text: string; cls: string }>;
  sections: string[];
  fields: Array<{ kind: string; name: string }>;
  buttons: string[];
  created: HTMLElement[];
};

function createFakeContainer(): HTMLElement & {
  recorded: Recorded;
  empty: () => void;
  createDiv: (opts?: { cls?: string }) => HTMLElement;
} {
  const recorded: Recorded = {
    warnings: [],
    sections: [],
    fields: [],
    buttons: [],
    created: [],
  };
  const children: HTMLElement[] = [];

  const el = {
    recorded,
    classList: { add: vi.fn() },
    firstChild: null as ChildNode | null,
    appendChild(child: Node): Node {
      children.push(child as HTMLElement);
      return child;
    },
    removeChild(child: Node): Node {
      const i = children.indexOf(child as HTMLElement);
      if (i >= 0) children.splice(i, 1);
      return child;
    },
    empty(): void {
      children.length = 0;
      recorded.warnings = [];
      recorded.sections = [];
      recorded.fields = [];
      recorded.buttons = [];
      recorded.created = [];
    },
    createDiv(opts?: { cls?: string }): HTMLElement {
      const div = {
        className: opts?.cls ?? "",
        textContent: "",
      } as HTMLElement;
      children.push(div);
      recorded.created.push(div);
      return div;
    },
  };
  return el as unknown as HTMLElement & {
    recorded: Recorded;
    empty: () => void;
    createDiv: (opts?: { cls?: string }) => HTMLElement;
  };
}

function createRecordingSettingCtor(recorded: Recorded): new (
  el: HTMLElement,
) => SettingLike {
  return class RecordingSetting implements SettingLike {
    private name = "";
    private desc = "";

    constructor(_el: HTMLElement) {}

    setName(name: string): SettingLike {
      this.name = name;
      return this;
    }
    setDesc(desc: string): SettingLike {
      this.desc = desc;
      return this;
    }
    setHeading(): SettingLike {
      recorded.sections.push(this.name);
      return this;
    }
    addText(cb: (text: TextComponentLike) => void): SettingLike {
      recorded.fields.push({ kind: "text", name: this.name });
      const text: TextComponentLike = {
        inputEl: {},
        setValue() {
          return text;
        },
        onChange() {
          return text;
        },
      };
      cb(text);
      return this;
    }
    addTextArea(cb: (text: TextComponentLike) => void): SettingLike {
      recorded.fields.push({ kind: "textarea", name: this.name });
      const text: TextComponentLike = {
        inputEl: {},
        setValue() {
          return text;
        },
        onChange() {
          return text;
        },
      };
      cb(text);
      return this;
    }
    addDropdown(cb: (d: {
      addOption: (v: string, l: string) => typeof d;
      setValue: (v: string) => typeof d;
      onChange: (cb: (v: string) => void) => typeof d;
    }) => void): SettingLike {
      recorded.fields.push({ kind: "dropdown", name: this.name });
      const dropdown = {
        addOption() {
          return dropdown;
        },
        setValue() {
          return dropdown;
        },
        onChange() {
          return dropdown;
        },
      };
      cb(dropdown);
      return this;
    }
    addButton(cb: (b: {
      setButtonText: (t: string) => typeof b;
      onClick: (cb: () => void) => typeof b;
    }) => void): SettingLike {
      const button = {
        setButtonText(t: string) {
          recorded.buttons.push(t);
          return button;
        },
        onClick() {
          return button;
        },
      };
      cb(button);
      void this.desc;
      return this;
    }
  };
}

describe("createObsidianSettingsHost", () => {
  it("paints warnings, sections, fields, and buttons via textContent", () => {
    const container = createFakeContainer();
    const SettingCtor = createRecordingSettingCtor(container.recorded);
    const host = createObsidianSettingsHost({
      containerEl: container,
      SettingCtor,
      cssPrefix: "syn",
    });

    host.clear();
    host.addWarning("Egress warning", "egress");
    host.addSection("Connection");
    host.addTextField({
      key: "endpoint",
      label: "API endpoint",
      description: "desc",
      value: "https://openrouter.ai/api/v1",
      onChange: vi.fn(),
    });
    host.addDropdown({
      key: "transport",
      label: "Transport",
      description: "desc",
      value: "auto",
      options: [{ value: "auto", label: "Auto" }],
      onChange: vi.fn(),
    });
    host.addButton({ label: "Acknowledge", onClick: vi.fn() });

    const warning = container.recorded.created.find((el) =>
      el.className.includes("syn-settings-warning--egress"),
    );
    expect(warning?.textContent).toBe("Egress warning");
    const section = container.recorded.created.find((el) =>
      el.className.includes("syn-settings-section"),
    );
    expect(section?.textContent).toBe("Connection");
    expect(container.recorded.fields.some((f) => f.kind === "text")).toBe(true);
    expect(container.recorded.fields.some((f) => f.kind === "dropdown")).toBe(
      true,
    );
    expect(container.recorded.buttons).toContain("Acknowledge");
  });

  it("uses textarea for excludedFolders", () => {
    const container = createFakeContainer();
    const SettingCtor = createRecordingSettingCtor(container.recorded);
    const host = createObsidianSettingsHost({
      containerEl: container,
      SettingCtor,
    });

    host.addTextField({
      key: "excludedFolders",
      label: "Folders",
      description: "desc",
      value: "a\nb",
      onChange: vi.fn(),
    });

    expect(container.recorded.fields[0]?.kind).toBe("textarea");
  });
});
