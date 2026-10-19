/**
 * A high-performance, fixed-capacity circular buffer (rolling window).
 *
 * - O(1) push, pop, shift, peek, and random access
 * - Zero allocations after construction (no array resizing, no GC pressure)
 * - Backed by a plain pre-allocated Array — no object wrappers per element
 * - Typed with generics
 */
export class RollingWindowBuffer<T> {
  private readonly buf: (T | undefined)[];
  private head: number = 0; // points to the oldest element
  private _size: number = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.capacity = capacity;
    this.buf = new Array<T | undefined>(capacity);
  }

  // ─── Core writes ───────────────────────────────────────────────────────────

  /**
   * Append an item. If the buffer is full the oldest item is silently dropped.
   * O(1)
   */
  push(value: T): this {
    const idx = (this.head + this._size) % this.capacity;
    this.buf[idx] = value;
    if (this._size < this.capacity) {
      this._size++;
    } else {
      // Overwrite oldest: advance head
      this.head = (this.head + 1) % this.capacity;
    }
    return this;
  }

  /**
   * Remove and return the newest item (LIFO / stack pop).
   * O(1) — returns undefined if empty.
   */
  pop(): T | undefined {
    if (this._size === 0) return undefined;
    this._size--;
    const idx = (this.head + this._size) % this.capacity;
    const val = this.buf[idx];
    this.buf[idx] = undefined; // release reference for GC
    return val;
  }

  /**
   * Remove and return the oldest item (FIFO / queue shift).
   * O(1) — returns undefined if empty.
   */
  shift(): T | undefined {
    if (this._size === 0) return undefined;
    const val = this.buf[this.head];
    this.buf[this.head] = undefined; // release reference for GC
    this.head = (this.head + 1) % this.capacity;
    this._size--;
    return val;
  }

  // ─── Peek / access ─────────────────────────────────────────────────────────

  /** Peek at the oldest item without removing it. O(1) */
  getFirst(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[this.head];
  }

  /** Peek at the newest item without removing it. O(1) */
  getLast(): T | undefined {
    if (this._size === 0) return undefined;
    return this.buf[(this.head + this._size - 1) % this.capacity];
  }

  /**
   * Return the last n items as a plain array, oldest → newest.
   * If n >= size, returns all items. If n <= 0, returns []. O(n)
   */
  getNLast(n: number): T[] {
    const count = Math.min(Math.max(n, 0), this._size);
    const out = new Array<T>(count);
    const start = this._size - count;
    for (let i = 0; i < count; i++) {
      out[i] = this.buf[(this.head + start + i) % this.capacity] as T;
    }
    return out;
  }

  /**
   * Random access by logical index.
   *   Positive: 0 = oldest, size-1 = newest.
   *   Negative: -1 = second-to-last, -2 = third-to-last, etc.
   *             (i.e. offset back from the newest item)
   * O(1) — returns undefined for out-of-bounds index.
   */
  getAt(index: number): T | undefined {
    const resolved = index < 0 ? this._size - 1 + index : index;
    if (resolved < 0 || resolved >= this._size) return undefined;
    return this.buf[(this.head + resolved) % this.capacity] as T;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  get size(): number {
    return this._size;
  }

  get isFull(): boolean {
    return this._size === this.capacity;
  }

  get isEmpty(): boolean {
    return this._size === 0;
  }

  /** Reset without re-allocating the backing array. O(n) to release refs. */
  clear(): this {
    this.buf.fill(undefined);
    this.head = 0;
    this._size = 0;
    return this;
  }

  // ─── Iteration ─────────────────────────────────────────────────────────────

  /** Iterate from oldest → newest. */
  [Symbol.iterator](): Iterator<T> {
    let i = 0;
    return {
      next: (): IteratorResult<T> => {
        if (i >= this._size) return { value: undefined as unknown as T, done: true };
        return { value: this.getAt(i++) as T, done: false };
      },
    };
  }

  /** Copy contents into a plain array, oldest → newest. O(n) */
  toArray(): T[] {
    const out = new Array<T>(this._size);
    for (let i = 0; i < this._size; i++) {
      out[i] = this.buf[(this.head + i) % this.capacity] as T;
    }
    return out;
  }

  // ─── Convenience ───────────────────────────────────────────────────────────

  /** Fill the window from an iterable. Older items are pushed first. */
  static from<T>(iterable: Iterable<T>, capacity: number): RollingWindowBuffer<T> {
    const w = new RollingWindowBuffer<T>(capacity);
    for (const item of iterable) w.push(item);
    return w;
  }

  toString(): string {
    return `RollingWindow(${this._size}/${this.capacity}) [${this.toArray().join(', ')}]`;
  }
}
