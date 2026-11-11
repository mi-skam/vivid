import { consola } from 'consola';

export async function promptText(message: string): Promise<string> {
  const response = await consola.prompt(message, {
    type: 'text',
    cancel: 'symbol',
  });
  if (typeof response === 'symbol') {
    process.exit(0);
  }
  return response;
}

export async function promptConfirm(
  message: string,
  initial = true,
): Promise<boolean> {
  const response = await consola.prompt(message, {
    type: 'confirm',
    initial,
    cancel: 'symbol',
  });
  if (typeof response === 'symbol') {
    process.exit(0);
  }
  return response;
}

/**
 * Reads a secret from the terminal without echoing it: every typed or pasted
 * character is shown as `*`, Backspace removes the last one, Enter confirms.
 * Ctrl+C (or Ctrl+D on an empty answer) cancels like the other prompts.
 * Escape sequences such as arrow keys and bracketed-paste markers are ignored.
 * Only call it when {@link isInteractive} is true: it needs a TTY on stdin.
 */
export async function promptSecret(message: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(`${message} `);
  return new Promise((resolve) => {
    let value = '';
    let inEscape = false;
    const wasRaw = stdin.isRaw;
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (inEscape) {
          // CSI sequences end with a letter or `~` (e.g. `\x1b[A`, `\x1b[200~`).
          if (/[A-Za-z~]/.test(char)) {
            inEscape = false;
          }
          continue;
        }
        if (char === '\u001b') {
          inEscape = true;
        } else if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        } else if (char === '\u0003' || (char === '\u0004' && !value)) {
          finish();
          process.exit(0);
        } else if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          value += char;
          stdout.write('*');
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
