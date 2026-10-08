/**
 * Minimal Obsidian stub for Vitest. Production loads the real module as external.
 * Adapters under test should inject fakes; this only satisfies module resolution.
 */

export type RequestUrlParam = {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  throw?: boolean;
};

export type RequestUrlResponse = {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
};

export function requestUrl(
  _request: RequestUrlParam | string,
): Promise<RequestUrlResponse> {
  throw new Error(
    "obsidian stub: inject requestUrl via RequestUrlTransportOptions in tests",
  );
}

export class Plugin {
  app!: App;
  manifest!: { dir?: string; id?: string };
  addCommand(_cmd: unknown): void {}
  addSettingTab(_tab: unknown): void {}
  addStatusBarItem(): HTMLElement {
    return { className: "", textContent: "" } as HTMLElement;
  }
  async loadData(): Promise<unknown> {
    return null;
  }
  async saveData(_data: unknown): Promise<void> {}
}

export class TFile {
  path = "";
  extension = "";
  stat = { mtime: 0, ctime: 0, size: 0 };
}

export class MarkdownView {
  editor: unknown = null;
  file: TFile | null = null;
}

export type App = {
  workspace: {
    onLayoutReady(cb: () => void): void;
    getActiveFile(): { path: string; extension: string } | null;
    getActiveViewOfType(_t: unknown): MarkdownView | null;
    getLeavesOfType(_t: string): { view: MarkdownView | null }[];
    on(_event: string, _cb: (...args: unknown[]) => void): { id: string };
    offref(_ref: { id: string }): void;
  };
  vault: {
    adapter: unknown;
    getFiles(): { path: string; extension: string; stat: { mtime: number; ctime: number; size: number } }[];
    getMarkdownFiles?: () => { path: string; extension: string }[];
    getAbstractFileByPath(_path: string): unknown;
    read(_file: unknown): Promise<string>;
    readBinary(_file: unknown): Promise<ArrayBuffer>;
    on(_event: string, _cb: (...args: unknown[]) => void): { id: string };
    offref(_ref: { id: string }): void;
  };
  metadataCache: {
    getCache(_path: string): unknown;
    resolvedLinks: Record<string, Record<string, number>>;
    on(_event: string, _cb: (...args: unknown[]) => void): { id: string };
    offref(_ref: { id: string }): void;
  };
};

function stubEl(): HTMLElement {
  const el = {
    className: "",
    textContent: "",
    createDiv(_opts?: unknown): HTMLElement {
      return stubEl();
    },
    createEl(_tag: string, _opts?: unknown): HTMLElement {
      return stubEl();
    },
    appendChild(_child: Node): Node {
      return _child;
    },
    setText(t: string): void {
      el.textContent = t;
    },
    addEventListener(_type: string, _cb: () => void): void {},
  };
  return el as unknown as HTMLElement;
}

export class Notice {
  noticeEl: HTMLElement;
  messageEl: HTMLElement;
  constructor(
    public message: string,
    _timeout?: number,
  ) {
    this.messageEl = stubEl();
    this.noticeEl = this.messageEl;
  }
  hide(): void {}
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(
    public app: App,
    public plugin: Plugin,
  ) {
    this.containerEl = {
      empty(): void {},
      createDiv(_opts?: unknown): HTMLElement {
        return {
          className: "",
          textContent: "",
          appendChild(_c: Node): Node {
            return _c;
          },
        } as HTMLElement;
      },
      classList: { add(_c: string): void {} },
      appendChild(_c: Node): Node {
        return _c;
      },
      removeChild(_c: Node): Node {
        return _c;
      },
      firstChild: null,
    } as unknown as HTMLElement;
  }
  display(): void {}
  hide(): void {}
}

type Chain = {
  setName(_n: string): Chain;
  setDesc(_d: string): Chain;
  setHeading(): Chain;
  addText(cb: (t: TextComp) => void): Chain;
  addTextArea(cb: (t: TextComp) => void): Chain;
  addDropdown(cb: (d: DropComp) => void): Chain;
  addButton(cb: (b: BtnComp) => void): Chain;
};

type TextComp = {
  setValue(_v: string): TextComp;
  onChange(_cb: (v: string) => void): TextComp;
  inputEl: { type?: string };
};

type DropComp = {
  addOption(_v: string, _l: string): DropComp;
  setValue(_v: string): DropComp;
  onChange(_cb: (v: string) => void): DropComp;
};

type BtnComp = {
  setButtonText(_t: string): BtnComp;
  onClick(_cb: () => void): BtnComp;
};

export class Setting implements Chain {
  constructor(_containerEl: HTMLElement) {}
  setName(_n: string): Chain {
    return this;
  }
  setDesc(_d: string): Chain {
    return this;
  }
  setHeading(): Chain {
    return this;
  }
  addText(cb: (t: TextComp) => void): Chain {
    const text: TextComp = {
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
  addTextArea(cb: (t: TextComp) => void): Chain {
    return this.addText(cb);
  }
  addDropdown(cb: (d: DropComp) => void): Chain {
    const dropdown: DropComp = {
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
  addButton(cb: (b: BtnComp) => void): Chain {
    const button: BtnComp = {
      setButtonText() {
        return button;
      },
      onClick() {
        return button;
      },
    };
    cb(button);
    return this;
  }
}
