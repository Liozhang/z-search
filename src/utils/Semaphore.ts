/**
 * Async Semaphore for concurrency control.
 * Pure TypeScript, no Zotero dependencies.
 *
 * acquire() returns a release function — caller must call it in a finally block.
 * The release function is idempotent (safe to call multiple times).
 */

export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private max: number) {}

  /** Acquire a slot. Returns a release function that must be called when done. */
  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryRun = () => {
        if (this.running < this.max) {
          this.running++;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            this.running--;
            const next = this.queue.shift();
            if (next) next();
          };
          resolve(release);
        } else {
          this.queue.push(tryRun);
        }
      };
      tryRun();
    });
  }
}
