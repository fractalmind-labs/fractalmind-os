/** Only the user's pending file selection survives the system picker taking
 * focus. No decrypted context, authority, proposal or signing quote lives here. */
export class OkrProjectionFilePicker<T> {
  private pending: { scope: string; file?: T } | null = null;
  private returning: { scope: string; file: T } | null = null;

  begin(scope: string) {
    this.cancel();
    this.pending = { scope };
  }

  select(scope: string, file: T) {
    if (!this.pending || this.pending.scope !== scope) return;
    this.pending.file = file;
  }

  take(scope: string, visible: boolean) {
    if (!visible || !this.pending) return null;
    if (this.pending.scope !== scope) {
      this.cancel();
      return null;
    }
    if (this.pending.file === undefined) return null;
    const selection = { scope, file: this.pending.file };
    this.pending = null;
    this.returning = selection;
    return selection;
  }

  current(selection: { scope: string; file: T }, scope: string) {
    return this.returning === selection && selection.scope === scope;
  }

  finish(selection: { scope: string; file: T }) {
    if (this.returning === selection) this.returning = null;
  }

  suspend() {
    // A selection already being read cannot restore private state after the
    // App backgrounds again. Only an outstanding picker may return a file.
    this.returning = null;
  }

  cancel() {
    this.pending = null;
    this.returning = null;
  }
}
