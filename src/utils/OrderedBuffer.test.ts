import { describe, test, expect } from 'bun:test';
import {
  OrderedBuffer,
  OrderedBufferEvictionSide,
  OrderedBufferSortDirection,
} from './OrderedBuffer';

describe('OrderedBuffer.add', () => {
  describe('Ascending order', () => {
    test('should add items in ascending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('third', 3);
      buffer.add('first', 1);
      buffer.add('second', 2);

      const result = buffer.getAll();
      expect(result).toEqual(['first', 'second', 'third']);
    });

    test('should maintain ascending order with string sortIndex', () => {
      const buffer = new OrderedBuffer<number, string>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add(3, 'c');
      buffer.add(1, 'a');
      buffer.add(2, 'b');

      const result = buffer.getAll();
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('Descending order', () => {
    test('should add items in descending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Descending,
        uniqueEntries: false,
      });

      buffer.add('first', 1);
      buffer.add('third', 3);
      buffer.add('second', 2);

      const result = buffer.getAll();
      expect(result).toEqual(['third', 'second', 'first']);
    });

    test('should maintain descending order with string sortIndex', () => {
      const buffer = new OrderedBuffer<number, string>({
        size: 5,
        direction: OrderedBufferSortDirection.Descending,
        uniqueEntries: false,
      });

      buffer.add(1, 'a');
      buffer.add(3, 'c');
      buffer.add(2, 'b');

      const result = buffer.getAll();
      expect(result).toEqual([3, 2, 1]);
    });
  });

  describe('Buffer capacity', () => {
    test('should not exceed capacity', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);

      expect(buffer.len()).toBe(3);
    });

    test('should shift oldest item when buffer is full', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);

      const result = buffer.getAll();
      expect(result).toEqual(['two', 'three', 'four']);
    });

    test('should handle multiple items exceeding capacity', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 2,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);
      buffer.add('five', 5);

      const result = buffer.getAll();
      expect(result).toEqual(['four', 'five']);
      expect(buffer.len()).toBe(2);
    });
  });

  describe('Removal side', () => {
    test('should remove from start when evictionSide is "FirstItem" in ascending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
        evictionSide: OrderedBufferEvictionSide.FirstItem,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);

      const result = buffer.getAll();
      expect(result).toEqual(['two', 'three', 'four']);
      expect(buffer.len()).toBe(3);
    });

    test('should remove from end when evictionSide is "LastItem" in ascending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
        evictionSide: OrderedBufferEvictionSide.LastItem,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);

      const result = buffer.getAll();
      expect(result).toEqual(['one', 'two', 'four']);
      expect(buffer.len()).toBe(3);
    });

    test('should remove from start when evictionSide is "FirstItem" in descending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Descending,
        uniqueEntries: false,
        evictionSide: OrderedBufferEvictionSide.FirstItem,
      });

      buffer.add('four', 4);
      buffer.add('three', 3);
      buffer.add('two', 2);
      buffer.add('one', 1);

      const result = buffer.getAll();
      expect(result).toEqual(['three', 'two', 'one']);
      expect(buffer.len()).toBe(3);
    });

    test('should remove from end when evictionSide is "LastItem" in descending order', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Descending,
        uniqueEntries: false,
        evictionSide: OrderedBufferEvictionSide.LastItem,
      });

      buffer.add('four', 4);
      buffer.add('three', 3);
      buffer.add('two', 2);
      buffer.add('one', 1);

      const result = buffer.getAll();
      expect(result).toEqual(['four', 'three', 'one']);
      expect(buffer.len()).toBe(3);
    });

    test('should default to removing from start when evictionSide is not specified', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('one', 1);
      buffer.add('two', 2);
      buffer.add('three', 3);
      buffer.add('four', 4);

      const result = buffer.getAll();
      expect(result).toEqual(['two', 'three', 'four']);
    });

    test('should consistently remove from specified side with multiple additions', () => {
      const buffer = new OrderedBuffer<number, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
        evictionSide: OrderedBufferEvictionSide.LastItem,
      });

      buffer.add(1, 1);
      buffer.add(2, 2);
      buffer.add(3, 3);
      buffer.add(4, 4);
      buffer.add(5, 5);
      buffer.add(6, 6);

      const result = buffer.getAll();
      expect(result).toEqual([1, 2, 6]);
      expect(buffer.len()).toBe(3);
    });

    test('should remove from start with unique entries', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
        evictionSide: OrderedBufferEvictionSide.FirstItem,
      });

      buffer.add('one', 1, 1);
      buffer.add('two', 2, 2);
      buffer.add('three', 3, 3);
      buffer.add('four', 4, 4);

      const result = buffer.getAll();
      expect(result).toEqual(['two', 'three', 'four']);
    });

    test('should remove from end with unique entries', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 3,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
        evictionSide: OrderedBufferEvictionSide.LastItem,
      });

      buffer.add('one', 1, 1);
      buffer.add('two', 2, 2);
      buffer.add('three', 3, 3);
      buffer.add('four', 4, 4);

      const result = buffer.getAll();
      expect(result).toEqual(['one', 'two', 'four']);
    });
  });

  describe('Unique entries', () => {
    test('should update existing item when uniqueIndex matches', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
      });

      buffer.add('original', 2, 100);
      buffer.add('updated', 3, 100);

      const result = buffer.getAll();
      expect(result).toEqual(['updated']);
      expect(buffer.len()).toBe(1);
    });

    test('should update sortIndex when updating unique entry', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
      });

      buffer.add('first', 1, 100);
      buffer.add('second', 2, 200);
      buffer.add('third', 3, 300);
      buffer.add('updated', 0, 200); // Update second item with lower sortIndex

      const result = buffer.getAll();
      expect(result).toEqual(['updated', 'first', 'third']);
    });

    test('should allow different uniqueIndex values', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
      });

      buffer.add('first', 1, 100);
      buffer.add('second', 2, 200);
      buffer.add('third', 3, 300);

      expect(buffer.len()).toBe(3);
      expect(buffer.getAll()).toEqual(['first', 'second', 'third']);
    });
  });

  describe('Non-unique entries', () => {
    test('should allow duplicate uniqueIndex values', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('first', 1, 100);
      buffer.add('second', 2, 100);
      buffer.add('third', 3, 100);

      expect(buffer.len()).toBe(3);
      expect(buffer.getAll()).toEqual(['first', 'second', 'third']);
    });

    test('should allow duplicate values with same sortIndex', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('same', 2);
      buffer.add('same', 2);
      buffer.add('same', 2);

      expect(buffer.len()).toBe(3);
      expect(buffer.getAll()).toEqual(['same', 'same', 'same']);
    });
  });

  describe('Default uniqueIndex', () => {
    test('should use default uniqueIndex of 0 when not provided', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
      });

      buffer.add('first', 1);
      buffer.add('second', 2);

      expect(buffer.len()).toBe(1);
      expect(buffer.getFirst()).toBe('second');
    });
  });

  describe('Edge cases', () => {
    test('should handle adding to empty buffer', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('first', 1);

      expect(buffer.len()).toBe(1);
      expect(buffer.getFirst()).toBe('first');
    });

    test('should handle buffer of size 1', () => {
      const buffer = new OrderedBuffer<string, number>({
        size: 1,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add('first', 1);
      buffer.add('second', 2);

      expect(buffer.len()).toBe(1);
      expect(buffer.getFirst()).toBe('second');
    });

    test('should maintain sorted order after multiple operations', () => {
      const buffer = new OrderedBuffer<number, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add(5, 5);
      buffer.add(1, 1);
      buffer.add(3, 3);
      buffer.add(2, 2);
      buffer.add(4, 4);

      expect(buffer.getAll()).toEqual([1, 2, 3, 4, 5]);
    });

    test('should duplicate items and give proper array', () => {
      const buffer = new OrderedBuffer<number, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: false,
      });

      buffer.add(5, 5, 5);
      buffer.add(1, 1, 1);
      buffer.add(3, 3, 3);
      buffer.add(2, 2, 2);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);

      expect(buffer.getAll()).toEqual([4, 4, 4, 4, 5]);
    });
    test('should not duplicate items and give proper array', () => {
      const buffer = new OrderedBuffer<number, number>({
        size: 5,
        direction: OrderedBufferSortDirection.Ascending,
        uniqueEntries: true,
      });

      buffer.add(5, 5, 5);
      buffer.add(1, 1, 1);
      buffer.add(3, 3, 3);
      buffer.add(2, 2, 2);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(4, 4, 4);
      buffer.add(6, 6, 6);
      buffer.add(1, 1, 1);

      expect(buffer.getAll()).toEqual([1, 3, 4, 5, 6]);
    });
  });
});

describe('OrderedBuffer.clear', () => {
  test('should clear all items from buffer', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add('first', 1);
    buffer.add('second', 2);
    buffer.add('third', 3);

    buffer.clear();

    expect(buffer.len()).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });

  test('should allow adding items after clear', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add('first', 1);
    buffer.clear();
    buffer.add('new', 10);

    expect(buffer.len()).toBe(1);
    expect(buffer.getFirst()).toBe('new');
  });

  test('should handle clearing empty buffer', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.clear();

    expect(buffer.len()).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });
});

describe('OrderedBuffer.sort', () => {
  test('should re-sort buffer in ascending order', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add('third', 3);
    buffer.add('first', 1);
    buffer.add('second', 2);
    buffer.sort();

    expect(buffer.getAll()).toEqual(['first', 'second', 'third']);
  });

  test('should re-sort buffer in descending order', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Descending,
      uniqueEntries: false,
    });

    buffer.add('first', 1);
    buffer.add('third', 3);
    buffer.add('second', 2);
    buffer.sort();

    expect(buffer.getAll()).toEqual(['third', 'second', 'first']);
  });

  test('should handle sorting empty buffer', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.sort();

    expect(buffer.len()).toBe(0);
    expect(buffer.getAll()).toEqual([]);
  });

  test('should handle sorting buffer with single item', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add('only', 1);
    buffer.sort();

    expect(buffer.len()).toBe(1);
    expect(buffer.getFirst()).toBe('only');
  });

  test('should maintain order with duplicate sortIndex values', () => {
    const buffer = new OrderedBuffer<string, number>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add('same1', 2);
    buffer.add('same2', 2);
    buffer.add('same3', 2);
    buffer.sort();

    expect(buffer.len()).toBe(3);
    expect(buffer.getAll()).toEqual(['same3', 'same2', 'same1']);
  });

  test('should sort with string sortIndex', () => {
    const buffer = new OrderedBuffer<number, string>({
      size: 5,
      direction: OrderedBufferSortDirection.Ascending,
      uniqueEntries: false,
    });

    buffer.add(3, 'c');
    buffer.add(1, 'a');
    buffer.add(2, 'b');
    buffer.sort();

    expect(buffer.getAll()).toEqual([1, 2, 3]);
  });
});
