/**
 * A two-player link: one host, one guest, joined by a four-letter room code.
 *
 * Real play goes peer to peer over WebRTC (PeerJS: its free public broker
 * only introduces the two browsers). Tests and same-machine demos use a
 * BroadcastChannel between tabs instead (`?net=local`). Only shadow shapes
 * and story state ever travel: never camera images, never the room.
 */

export type Role = 'host' | 'guest';
export type Transport = 'peer' | 'local';
export type Payload = ArrayBuffer | string;

export interface Link {
  readonly role: Role;
  readonly code: string;
  /** True while the other player is on the line. */
  readonly connected: boolean;
  send(data: Payload): void;
  onMessage: ((data: Payload) => void) | null;
  /** The other player arrived (or, for a guest, the host answered). */
  onOpen: (() => void) | null;
  /** The other player left. A host keeps listening for them to come back. */
  onClose: (() => void) | null;
  close(): void;
}

/** Consonants only: no accidental words, and nothing to confuse (no I/O/0/1). */
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const PREFIX = 'shadowplay-vrstart-';

export function newCode(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  return s;
}

/** A code as typed or linked ("foxy", " BCDF "), or null if it can't be one. */
export function normaliseCode(s: string | null | undefined): string | null {
  const c = (s ?? '').trim().toUpperCase();
  return c.length === 4 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export async function openLink(role: Role, code: string, transport: Transport): Promise<Link> {
  return transport === 'local' ? new LocalLink(role, code) : PeerLink.open(role, code);
}

/** Between tabs of one browser: the guest knocks, the host answers. */
class LocalLink implements Link {
  connected = false;
  onMessage: ((data: Payload) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private readonly ch: BroadcastChannel;

  constructor(
    readonly role: Role,
    readonly code: string,
  ) {
    this.ch = new BroadcastChannel(`${PREFIX}${code}`);
    this.ch.onmessage = (e: MessageEvent<{ from: Role; knock?: true; bye?: true; data?: Payload }>) => {
      const m = e.data;
      if (!m || m.from === role) return;
      if (m.knock) {
        // A guest knocked (or a host answered): both sides are on the line.
        if (role === 'host') this.ch.postMessage({ from: role, knock: true });
        this.up();
      } else if (m.bye) {
        this.connected = false;
        this.onClose?.();
      } else if (m.data !== undefined) this.onMessage?.(m.data);
    };
    // A guest keeps knocking until the host's tab is there to answer.
    if (role === 'guest') {
      const knock = () => (this.connected ? clearInterval(this.knocker) : this.ch.postMessage({ from: role, knock: true }));
      knock();
      this.knocker = setInterval(knock, 1000);
    }
  }

  private knocker: ReturnType<typeof setInterval> | undefined;

  private up(): void {
    if (this.connected) return;
    this.connected = true;
    // Let the caller attach its handlers first.
    queueMicrotask(() => this.onOpen?.());
  }

  send(data: Payload): void {
    if (this.connected) this.ch.postMessage({ from: this.role, data });
  }

  close(): void {
    clearInterval(this.knocker);
    this.ch.postMessage({ from: this.role, bye: true });
    this.connected = false;
    this.ch.close();
  }
}

type PeerModule = typeof import('peerjs');
type Peer = InstanceType<PeerModule['Peer']>;
type DataConnection = ReturnType<Peer['connect']>;

/** Over WebRTC, introduced by the PeerJS broker. */
class PeerLink implements Link {
  onMessage: ((data: Payload) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private conn: DataConnection | null = null;

  private constructor(
    readonly role: Role,
    readonly code: string,
    private readonly peer: Peer,
  ) {}

  get connected(): boolean {
    return !!this.conn?.open;
  }

  static async open(role: Role, code: string): Promise<Link> {
    const { Peer } = await import('peerjs');
    const peer = role === 'host' ? new Peer(`${PREFIX}${code}`, { debug: 0 }) : new Peer({ debug: 0 });
    await new Promise<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', (e) => reject(e));
    });
    const link = new PeerLink(role, code, peer);
    if (role === 'host') {
      // One guest at a time; a guest who drops out can come back.
      peer.on('connection', (conn) => {
        if (link.conn?.open) {
          conn.on('open', () => conn.close());
          return;
        }
        link.attach(conn);
      });
    } else {
      const conn = peer.connect(`${PREFIX}${code}`, { serialization: 'raw', reliable: true });
      link.attach(conn);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('No theatre answered with that code.')), 15000);
        conn.once('open', () => {
          clearTimeout(t);
          resolve();
        });
        peer.once('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
    }
    // Keep the broker connection for a host (so a guest can come back), and survive brief drops.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    return link;
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => this.onOpen?.());
    conn.on('data', (d) => {
      if (typeof d === 'string') this.onMessage?.(d);
      else if (d instanceof ArrayBuffer) this.onMessage?.(d);
      else if (ArrayBuffer.isView(d)) this.onMessage?.(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
    });
    conn.on('close', () => {
      if (this.conn === conn) this.conn = null;
      this.onClose?.();
    });
    conn.on('error', () => conn.close());
  }

  send(data: Payload): void {
    if (this.conn?.open) void this.conn.send(data);
  }

  close(): void {
    this.conn?.close();
    this.peer.destroy();
  }
}
