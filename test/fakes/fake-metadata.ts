/**
 * In-memory MetadataPort for CI (DESIGN §5.2 / §9). Controllable resolvedLinks.
 */

import {
  asVaultPath,
  type Disposable,
  type MetadataPort,
  type NoteMetadata,
  type VaultPath,
} from "../../src/core";

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

export class FakeMetadata implements MetadataPort {
  private readonly byPath = new Map<string, NoteMetadata | null>();
  private links: Record<string, Record<string, number>> = {};
  private resolved = true;
  private readonly changed = new Set<(path: VaultPath) => void>();
  private readonly resolvedListeners = new Set<() => void>();

  set(path: string, meta: NoteMetadata | null): void {
    this.byPath.set(normalizePath(path), meta);
  }

  setResolved(value: boolean): void {
    this.resolved = value;
  }

  /** Replace the full source → target → count map returned by resolvedLinks(). */
  setResolvedLinks(links: Record<string, Record<string, number>>): void {
    this.links = links;
  }

  emitChanged(path: string): void {
    const p = normalizePath(path);
    for (const cb of [...this.changed]) {
      cb(p);
    }
  }

  emitResolved(): void {
    this.resolved = true;
    for (const cb of [...this.resolvedListeners]) {
      cb();
    }
  }

  isResolved(): boolean {
    return this.resolved;
  }

  get(path: VaultPath): NoteMetadata | null {
    if (!this.byPath.has(path)) {
      return null;
    }
    return this.byPath.get(path) ?? null;
  }

  resolvedLinks(): Record<string, Record<string, number>> {
    return this.links;
  }

  onChanged(cb: (path: VaultPath) => void): Disposable {
    this.changed.add(cb);
    return () => {
      this.changed.delete(cb);
    };
  }

  onResolved(cb: () => void): Disposable {
    this.resolvedListeners.add(cb);
    return () => {
      this.resolvedListeners.delete(cb);
    };
  }
}
