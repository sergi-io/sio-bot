/**
 * SortDirection represents the sorting order (ascending or descending)
 */
export enum OrderedBufferSortDirection {
  Ascending = 0, // Sort in ascending order
  Descending = 1, // Sort in descending order
}

export enum OrderedBufferEvictionSide {
  FirstItem = 'first',
  LastItem = 'last',
}

/**
 * OrderedBufferItem represents an item in the buffer with a value and sorting index
 */
interface OrderedBufferItem<T, S extends number | string> {
  value: T;
  sortIndex: S;
  uniqueIndex: number;
}

interface OrderedBufferConstructorParams {
  size: number; // Maximum size of the buffer
  direction: OrderedBufferSortDirection; // Sorting direction
  uniqueEntries: boolean; // Whether to enforce unique entries
  evictionSide?: OrderedBufferEvictionSide; // Direction to remove items when at capacity (not used in current implementation)
}

/**
 * OrderedBuffer is a thread-safe sorted buffer with optional unique entries
 */
export class OrderedBuffer<T, S extends number | string> {
  public data: OrderedBufferItem<T, S>[];
  private readonly capacity: number;
  private readonly compare: (a: S, b: S) => boolean;
  private readonly uniqueEntries: boolean;
  private readonly evictionSide: OrderedBufferEvictionSide;
  private uniqueIndexMap: Map<number, number>; // Maps uniqueIndex to array index

  constructor({
    size,
    direction,
    uniqueEntries,
    evictionSide = OrderedBufferEvictionSide.FirstItem,
  }: OrderedBufferConstructorParams) {
    this.capacity = size;
    this.data = [];
    this.uniqueEntries = uniqueEntries;
    this.evictionSide = evictionSide;
    this.uniqueIndexMap = new Map();

    // Set up comparator function based on sort direction
    if (direction === OrderedBufferSortDirection.Ascending) {
      this.compare = (a: S, b: S) => a < b;
    } else {
      this.compare = (a: S, b: S) => a > b;
    }
  }

  /**
   * Binary search to find insertion position
   */
  private findInsertPosition(sortIndex: S): number {
    let left = 0;
    let right = this.data.length;

    while (left < right) {
      const mid = (left + right) >>> 1; // Fast integer division by 2
      const midItem = this.data[mid]!;
      if (this.compare(midItem.sortIndex, sortIndex)) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  /**
   * Rebuilds the uniqueIndexMap after array modifications
   */
  private rebuildUniqueIndexMap(): void {
    if (!this.uniqueEntries) return;

    this.uniqueIndexMap.clear();
    for (let i = 0; i < this.data.length; i++) {
      this.uniqueIndexMap.set(this.data[i]!.uniqueIndex, i);
    }
  }

  /**
   * Adds a value to the buffer with the given sort index
   * @param value The value to add
   * @param sortIndex The index used for sorting
   * @param uniqueIndex Optional unique identifier for the entry
   */
  add(value: T, sortIndex: S, uniqueIndex: number = 0): void {
    // Check for existing item with same uniqueIndex if uniqueEntries is enabled
    if (this.uniqueEntries && this.uniqueIndexMap.has(uniqueIndex)) {
      const existingIdx = this.uniqueIndexMap.get(uniqueIndex)!;
      const item = this.data[existingIdx]!;

      // If sortIndex hasn't changed, just update value
      if (item.sortIndex === sortIndex) {
        item.value = value;
        return;
      }

      // Remove old entry and add new one at correct position
      this.data.splice(existingIdx, 1);
    }

    const newItem: OrderedBufferItem<T, S> = { value, sortIndex, uniqueIndex };

    // Handle buffer at capacity
    if (this.data.length >= this.capacity) {
      const removed =
        this.evictionSide === OrderedBufferEvictionSide.FirstItem
          ? this.data.shift()!
          : this.data.pop()!;
      if (this.uniqueEntries) {
        this.uniqueIndexMap.delete(removed.uniqueIndex);
      }
    }

    // Binary search for correct insertion position
    const insertPos = this.findInsertPosition(sortIndex);
    this.data.splice(insertPos, 0, newItem);

    if (insertPos < this.capacity - 1 && this.uniqueEntries) {
      this.rebuildUniqueIndexMap();
    }
  }

  getAll(): T[] {
    return this.data.map((item) => item.value);
  }

  clear(): void {
    this.data = [];
    this.uniqueIndexMap.clear();
  }

  getPrevious(amount: number): T[] {
    if (amount <= 0) {
      return [];
    }

    const startIndex = Math.max(this.data.length - amount, 0);
    return this.data.slice(startIndex).map((item) => item.value);
  }

  getLast(): T | null {
    return this.getLastByIndex(0);
  }

  getLastByIndex(idx: number): T | null {
    if (this.data.length < idx + 1) {
      return null;
    }
    const item = this.data[this.data.length - 1 - idx];
    return item ? item.value : null;
  }

  getFirst(): T | null {
    return this.data[0]?.value ?? null;
  }

  len(): number {
    return this.data.length;
  }

  getBySortIndex(idx: S): T | null {
    return (
      this.data.find((item) => {
        return item.sortIndex === idx;
      })?.value ?? null
    );
  }

  /**
   * Forces a complete re-sort of the buffer based on current sort direction
   */
  sort(): void {
    this.data.sort((a, b) => {
      if (a.sortIndex === b.sortIndex) return 0;
      return this.compare(a.sortIndex, b.sortIndex) ? -1 : 1;
    });

    if (this.uniqueEntries) {
      this.rebuildUniqueIndexMap();
    }
  }

  isFull(): boolean {
    return this.data.length >= this.capacity;
  }
}
