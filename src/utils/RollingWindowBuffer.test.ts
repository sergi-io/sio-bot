import { describe, test, expect } from 'bun:test';
import { RollingWindowBuffer } from './RollingWindowBuffer';

describe('RollingWindowBuffer — constructor', () => {
  test('creates a window with the given capacity', () => {
    const w = new RollingWindowBuffer<number>(5);
    expect(w.capacity).toBe(5);
    expect(w.size).toBe(0);
    expect(w.isEmpty).toBe(true);
    expect(w.isFull).toBe(false);
  });

  test('throws RangeError for capacity < 1', () => {
    expect(() => new RollingWindowBuffer(0)).toThrow(RangeError);
    expect(() => new RollingWindowBuffer(-1)).toThrow(RangeError);
  });
});

describe('RollingWindowBuffer — push', () => {
  test('appends items and updates size', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.size).toBe(3);
    expect(w.isFull).toBe(true);
  });

  test('silently drops oldest item when full', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).push(4);
    expect(w.size).toBe(3);
    expect(w.toArray()).toEqual([2, 3, 4]);
  });

  test('oldest item is correctly evicted after many pushes', () => {
    const w = new RollingWindowBuffer<number>(3);
    for (let i = 1; i <= 10; i++) w.push(i);
    expect(w.toArray()).toEqual([8, 9, 10]);
  });

  test('returns this for chaining', () => {
    const w = new RollingWindowBuffer<number>(3);
    expect(w.push(1)).toBe(w);
  });
});

describe('RollingWindowBuffer — pop', () => {
  test('removes and returns the newest item', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.pop()).toBe(3);
    expect(w.size).toBe(2);
  });

  test('returns undefined when empty', () => {
    expect(new RollingWindowBuffer<number>(3).pop()).toBeUndefined();
  });

  test('pops in LIFO order', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.pop()).toBe(3);
    expect(w.pop()).toBe(2);
    expect(w.pop()).toBe(1);
    expect(w.pop()).toBeUndefined();
  });
});

describe('RollingWindowBuffer — shift', () => {
  test('removes and returns the oldest item', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.shift()).toBe(1);
    expect(w.size).toBe(2);
  });

  test('returns undefined when empty', () => {
    expect(new RollingWindowBuffer<number>(3).shift()).toBeUndefined();
  });

  test('shifts in FIFO order', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(10).push(20).push(30);
    expect(w.shift()).toBe(10);
    expect(w.shift()).toBe(20);
    expect(w.shift()).toBe(30);
    expect(w.shift()).toBeUndefined();
  });
});

describe('RollingWindowBuffer — getNLast', () => {
  test('returns the last n items oldest → newest', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2).push(3).push(4).push(5);
    expect(w.getNLast(3)).toEqual([3, 4, 5]);
  });

  test('returns all items when n >= size', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2).push(3);
    expect(w.getNLast(10)).toEqual([1, 2, 3]);
  });

  test('returns empty array when n <= 0', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2).push(3);
    expect(w.getNLast(0)).toEqual([]);
    expect(w.getNLast(-5)).toEqual([]);
  });

  test('returns empty array when buffer is empty', () => {
    const w = new RollingWindowBuffer<number>(5);
    expect(w.getNLast(3)).toEqual([]);
  });

  test('works correctly after wrap-around', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).push(4).push(5); // buffer: [3, 4, 5]
    expect(w.getNLast(2)).toEqual([4, 5]);
  });

  test('snapshot is independent of later mutations', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2).push(3).push(4).push(5);
    const snapshot = w.getNLast(3);
    w.push(6);
    expect(snapshot).toEqual([3, 4, 5]);
  });

  test('returns single item when n is 1', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(10).push(20).push(30);
    expect(w.getNLast(1)).toEqual([30]);
  });
});

describe('RollingWindowBuffer — getFirst / getLast', () => {
  test('getFirst returns oldest without removing', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.getFirst()).toBe(1);
    expect(w.size).toBe(3);
  });

  test('getLast returns newest without removing', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    expect(w.getLast()).toBe(3);
    expect(w.size).toBe(3);
  });

  test('getFirst returns undefined when empty', () => {
    expect(new RollingWindowBuffer<number>(3).getFirst()).toBeUndefined();
  });

  test('getLast returns undefined when empty', () => {
    expect(new RollingWindowBuffer<number>(3).getLast()).toBeUndefined();
  });

  test('getFirst/getLast equal when size is 1', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(42);
    expect(w.getFirst()).toBe(42);
    expect(w.getLast()).toBe(42);
  });
});

describe('RollingWindowBuffer — getAt', () => {
  test('returns item at logical index (0 = oldest)', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(10).push(20).push(30);
    expect(w.getAt(0)).toBe(10);
    expect(w.getAt(1)).toBe(20);
    expect(w.getAt(2)).toBe(30);
  });

  test('throws RangeError for out-of-bounds positive index', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2);
    expect(w.getAt(2)).toBeUndefined();
    expect(w.getAt(99)).toBeUndefined();
  });

  test('works correctly after wrap-around', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).push(4); // evicts 1
    expect(w.getAt(0)).toBe(2);
    expect(w.getAt(1)).toBe(3);
    expect(w.getAt(2)).toBe(4);
  });
});

describe('RollingWindowBuffer — at (negative indices)', () => {
  test('at(-1) returns second-to-last item', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(10).push(20).push(30);
    expect(w.getAt(-1)).toBe(20); // one back from newest (30)
  });

  test('at(-2) returns third-to-last item', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(10).push(20).push(30).push(40);
    expect(w.getAt(-2)).toBe(20); // two back from newest (40)
  });

  test('at(-(size-1)) returns oldest item', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2).push(3).push(4);
    expect(w.getAt(-3)).toBe(1); // -(4-1) = oldest
  });

  test('throws RangeError when negative index exceeds available items', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(10).push(20).push(30);
    expect(w.getAt(-3)).toBeUndefined(); // only 2 items before newest
    expect(w.getAt(-99)).toBeUndefined();
  });

  test('throws RangeError when buffer has only one item', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(42);
    expect(w.getAt(-1)).toBeUndefined(); // no second-to-last exists
  });

  test('throws RangeError on any negative index when empty', () => {
    const w = new RollingWindowBuffer<number>(5);
    expect(w.getAt(-1)).toBeUndefined();
  });

  test('works correctly after wrap-around with negative indices', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).push(4).push(5); // buffer: [3, 4, 5]
    expect(w.getAt(-1)).toBe(4); // second-to-last
    expect(w.getAt(-2)).toBe(3); // third-to-last / oldest
    expect(w.getAt(-3)).toBeUndefined();
  });
});

describe('RollingWindowBuffer — state flags', () => {
  test('isEmpty is true only when size is 0', () => {
    const w = new RollingWindowBuffer<number>(2);
    expect(w.isEmpty).toBe(true);
    w.push(1);
    expect(w.isEmpty).toBe(false);
  });

  test('isFull is true only when size equals capacity', () => {
    const w = new RollingWindowBuffer<number>(2);
    expect(w.isFull).toBe(false);
    w.push(1);
    expect(w.isFull).toBe(false);
    w.push(2);
    expect(w.isFull).toBe(true);
  });
});

describe('RollingWindowBuffer — clear', () => {
  test('resets size and logical contents', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.isEmpty).toBe(true);
    expect(w.toArray()).toEqual([]);
  });

  test('returns this for chaining', () => {
    const w = new RollingWindowBuffer<number>(3);
    expect(w.clear()).toBe(w);
  });

  test('can push items after clear', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).clear().push(99);
    expect(w.size).toBe(1);
    expect(w.getFirst()).toBe(99);
  });
});

describe('RollingWindowBuffer — iteration', () => {
  test('iterates oldest → newest', () => {
    const w = new RollingWindowBuffer<number>(4);
    w.push(1).push(2).push(3);
    expect([...w]).toEqual([1, 2, 3]);
  });

  test('iterates correctly after wrap-around', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3).push(4).push(5);
    expect([...w]).toEqual([3, 4, 5]);
  });

  test('iterates empty window without yielding values', () => {
    expect([...new RollingWindowBuffer<number>(3)]).toEqual([]);
  });
});

describe('RollingWindowBuffer — toArray', () => {
  test('returns a plain array oldest → newest', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(7).push(8).push(9);
    expect(w.toArray()).toEqual([7, 8, 9]);
  });

  test('snapshot is independent of later mutations', () => {
    const w = new RollingWindowBuffer<number>(3);
    w.push(1).push(2).push(3);
    const snapshot = w.toArray();
    w.push(4);
    expect(snapshot).toEqual([1, 2, 3]);
    expect(w.toArray()).toEqual([2, 3, 4]);
  });
});

describe('RollingWindowBuffer — static from', () => {
  test('builds from an array with exact capacity', () => {
    const w = RollingWindowBuffer.from([1, 2, 3], 3);
    expect(w.size).toBe(3);
    expect(w.toArray()).toEqual([1, 2, 3]);
  });

  test('keeps only the last N items when iterable exceeds capacity', () => {
    const w = RollingWindowBuffer.from([1, 2, 3, 4, 5], 3);
    expect(w.toArray()).toEqual([3, 4, 5]);
  });

  test('works with a Set', () => {
    const w = RollingWindowBuffer.from(new Set([10, 20, 30]), 5);
    expect(w.toArray()).toEqual([10, 20, 30]);
  });
});

describe('RollingWindowBuffer — toString', () => {
  test('returns a descriptive string', () => {
    const w = new RollingWindowBuffer<number>(5);
    w.push(1).push(2);
    expect(w.toString()).toBe('RollingWindow(2/5) [1, 2]');
  });

  test('shows empty correctly', () => {
    expect(new RollingWindowBuffer<number>(3).toString()).toBe('RollingWindow(0/3) []');
  });
});

describe('RollingWindowBuffer — generics', () => {
  test('works with strings', () => {
    const w = new RollingWindowBuffer<string>(3);
    w.push('a').push('b').push('c');
    expect(w.toArray()).toEqual(['a', 'b', 'c']);
  });

  test('works with objects', () => {
    const w = new RollingWindowBuffer<{ v: number }>(2);
    const a = { v: 1 };
    const b = { v: 2 };
    w.push(a).push(b);
    expect(w.getFirst()).toBe(a);
    expect(w.getLast()).toBe(b);
  });
});

describe('RollingWindowBuffer — capacity 1 edge case', () => {
  test('always holds only the latest item', () => {
    const w = new RollingWindowBuffer<number>(1);
    w.push(1);
    expect(w.toArray()).toEqual([1]);
    w.push(2);
    expect(w.toArray()).toEqual([2]);
    w.push(3);
    expect(w.toArray()).toEqual([3]);
  });
});
