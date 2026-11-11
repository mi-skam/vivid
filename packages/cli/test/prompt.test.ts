import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promptSecret } from '../src/prompt';

/** A fake TTY stdin that records raw-mode changes. */
class FakeStdin extends EventEmitter {
  isRaw = false;
  rawModes: boolean[] = [];
  setRawMode(mode: boolean) {
    this.rawModes.push(mode);
    this.isRaw = mode;
    return this;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
}

describe('promptSecret', () => {
  let stdin: FakeStdin;
  let written: string[];

  beforeEach(() => {
    stdin = new FakeStdin();
    written = [];
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(
      stdin as unknown as typeof process.stdin,
    );
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks every character, handles backspace and restores the terminal', async () => {
    const answer = promptSecret('Key:');
    stdin.emit('data', 'vivid_sk');
    stdin.emit('data', 'x\u007f_v1\r');

    expect(await answer).toBe('vivid_sk_v1');
    const echoed = written.join('');
    expect(echoed).toBe(`Key: ${'*'.repeat(9)}\b \b${'*'.repeat(3)}\n`);
    expect(echoed).not.toContain('vivid');
    expect(stdin.rawModes).toEqual([true, false]);
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('takes a pasted key in one chunk and ignores escape sequences', async () => {
    const answer = promptSecret('Key:');
    stdin.emit('data', '\u001b[200~vivid_sk_v1_abc\u001b[201~\u001b[A\r');

    expect(await answer).toBe('vivid_sk_v1_abc');
    expect(written.join('')).toBe(`Key: ${'*'.repeat(15)}\n`);
  });

  it('cancels on Ctrl+C like the other prompts', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(0)');
    }) as (code?: number) => never);
    void promptSecret('Key:');

    expect(() => stdin.emit('data', 'abc\u0003')).toThrow('process.exit(0)');
    expect(exit).toHaveBeenCalledWith(0);
    expect(stdin.rawModes).toEqual([true, false]);
  });
});
