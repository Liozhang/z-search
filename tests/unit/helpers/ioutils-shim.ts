/**
 * IOUtils test shim — implements the subset of Gecko's IOUtils the modules
 * under test use, backed by node:fs, so host-dependent storage (e.g. the
 * persistent translation cache) can run end-to-end in vitest.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function installIOUTilsShim(): void {
  const shim = {
    async read(file: string): Promise<Uint8Array> {
      return new Uint8Array(fs.readFileSync(file));
    },
    async write(file: string, data: Uint8Array | ArrayBuffer): Promise<void> {
      const buf =
        data instanceof Uint8Array
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : Buffer.from(data);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    },
    async makeDirectory(
      dir: string,
      options?: { createDirs?: boolean; ignoreExisting?: boolean },
    ): Promise<void> {
      fs.mkdirSync(dir, { recursive: !!options?.createDirs });
    },
    async getChildren(dir: string): Promise<any[]> {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      return entries.map((e) => {
        const full = path.join(dir, e.name);
        let size = 0;
        if (!e.isDirectory()) {
          try {
            size = fs.statSync(full).size;
          } catch {
            size = 0;
          }
        }
        return { path: full, name: e.name, isDirectory: e.isDirectory(), size };
      });
    },
    async hasChildren(dir: string): Promise<boolean> {
      try {
        return fs.readdirSync(dir).length > 0;
      } catch {
        return false;
      }
    },
    async exists(target: string): Promise<boolean> {
      return fs.existsSync(target);
    },
    async stat(target: string): Promise<any> {
      const st = fs.statSync(target);
      return { type: st.isDirectory() ? "directory" : "file", size: st.size };
    },
    async remove(
      target: string,
      options?: { recursive?: boolean },
    ): Promise<void> {
      fs.rmSync(target, { recursive: !!options?.recursive, force: true });
    },
  };
  (globalThis as any).IOUtils = shim;
}

export function uninstallIOUTilsShim(): void {
  delete (globalThis as any).IOUtils;
}
