/**
 * Pulls finished script steps out of a beat's JSON while it is still
 * streaming, so the first narration line can play before the model has
 * written the rest of the beat. The output is schema-constrained, so a small
 * bracket scanner is enough: an object that opens and closes directly inside
 * the root's array ("script") is one complete step.
 */
export class StepExtractor {
  private buf = '';
  private pos = 0;
  private readonly stack: string[] = [];
  private inStr = false;
  private esc = false;
  private stepStart = -1;

  /** Feeds more text; returns the steps completed by it, in order. */
  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    this.buf += chunk;
    const s = this.buf;
    for (; this.pos < s.length; this.pos++) {
      const c = s[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') this.inStr = false;
        continue;
      }
      if (c === '"') this.inStr = true;
      else if (c === '{' || c === '[') {
        if (c === '{' && this.stack.length === 2 && this.stack[0] === '{' && this.stack[1] === '[') this.stepStart = this.pos;
        this.stack.push(c);
      } else if (c === '}' || c === ']') {
        this.stack.pop();
        if (c === '}' && this.stepStart >= 0 && this.stack.length === 2) {
          try {
            out.push(JSON.parse(s.slice(this.stepStart, this.pos + 1)));
          } catch {
            /* not a step after all */
          }
          this.stepStart = -1;
        }
      }
    }
    return out;
  }

  get text(): string {
    return this.buf;
  }
}
