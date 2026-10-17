import http from 'node:http';

/** One event frame from the event stream, with its `data` parsed as JSON. */
export interface Frame {
  seq: number;
  kind: string;
  payload: unknown;
}

function parseFrame(raw: string): Frame {
  const lines = raw.split('\n');
  const idLine = lines.find((l) => l.startsWith('id: '));
  const eventLine = lines.find((l) => l.startsWith('event: '));
  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (!idLine || !eventLine || !dataLine) {
    throw new Error(`malformed SSE frame: ${JSON.stringify(raw)}`);
  }
  return {
    seq: Number(idLine.slice('id: '.length)),
    kind: eventLine.slice('event: '.length),
    payload: JSON.parse(dataLine.slice('data: '.length)),
  };
}

/** Reads SSE frames off `res` as they arrive, keeping comments such as keepalives apart from event frames. */
export class FrameReader {
  private buffer = '';
  private readonly frames: Frame[] = [];
  private readonly commentLines: string[] = [];
  private waiters: Array<{ ready: () => boolean; resolve: () => void }> = [];

  constructor(res: http.IncomingMessage) {
    res.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        if (raw.startsWith(':')) this.commentLines.push(raw.slice(1).trim());
        else this.frames.push(parseFrame(raw));
        this.checkWaiters();
      }
    });
  }

  private checkWaiters() {
    this.waiters = this.waiters.filter((w) => {
      if (!w.ready()) return true;
      w.resolve();
      return false;
    });
  }

  private waitUntil(ready: () => boolean, what: string, timeoutMs: number): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
      this.waiters.push({
        ready,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  /** Resolves with the first `count` frames received so far, once there are that many. */
  async waitFor(count: number, timeoutMs = 2000): Promise<Frame[]> {
    await this.waitUntil(() => this.frames.length >= count, `${count} frame(s)`, timeoutMs);
    return this.frames.slice(0, count);
  }

  /** Resolves with the first `count` comments received so far, once there are that many. */
  async waitForComments(count: number, timeoutMs = 2000): Promise<string[]> {
    await this.waitUntil(() => this.commentLines.length >= count, `${count} comment(s)`, timeoutMs);
    return this.commentLines.slice(0, count);
  }

  all(): Frame[] {
    return [...this.frames];
  }

  comments(): string[] {
    return [...this.commentLines];
  }
}

/** Opens the event stream at `path` on `127.0.0.1:port` and resolves once the response headers arrive. */
export function openSse(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ req: http.ClientRequest; res: http.IncomingMessage; reader: FrameReader }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => {
      resolve({ req, res, reader: new FrameReader(res) });
    });
    req.on('error', reject);
    req.end();
  });
}
