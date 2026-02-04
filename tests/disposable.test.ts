import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DisposableCollection } from '../src/disposable.js';

describe('DisposableCollection', () => {
  let collection: DisposableCollection;

  beforeEach(() => {
    collection = new DisposableCollection();
  });

  describe('add', () => {
    it('should add a disposable and return it', () => {
      const disposable = { dispose: vi.fn() };

      const result = collection.add(disposable);

      expect(result).toBe(disposable);
      expect(collection.size).toBe(1);
    });

    it('should throw if collection is disposed', () => {
      collection.dispose();

      expect(() => collection.add({ dispose: vi.fn() })).toThrow(
        'Cannot add to a disposed DisposableCollection'
      );
    });
  });

  describe('push', () => {
    it('should add multiple disposables', () => {
      const d1 = { dispose: vi.fn() };
      const d2 = { dispose: vi.fn() };
      const d3 = { dispose: vi.fn() };

      collection.push(d1, d2, d3);

      expect(collection.size).toBe(3);
    });

    it('should throw if collection is disposed', () => {
      collection.dispose();

      expect(() => collection.push({ dispose: vi.fn() })).toThrow(
        'Cannot add to a disposed DisposableCollection'
      );
    });
  });

  describe('size', () => {
    it('should return 0 for empty collection', () => {
      expect(collection.size).toBe(0);
    });

    it('should return correct count after adding disposables', () => {
      collection.push({ dispose: vi.fn() }, { dispose: vi.fn() });

      expect(collection.size).toBe(2);
    });

    it('should return 0 after dispose', () => {
      collection.push({ dispose: vi.fn() });
      collection.dispose();

      expect(collection.size).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should call dispose on all disposables', () => {
      const d1 = { dispose: vi.fn() };
      const d2 = { dispose: vi.fn() };
      const d3 = { dispose: vi.fn() };
      collection.push(d1, d2, d3);

      collection.dispose();

      expect(d1.dispose).toHaveBeenCalledTimes(1);
      expect(d2.dispose).toHaveBeenCalledTimes(1);
      expect(d3.dispose).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call dispose multiple times', () => {
      const disposable = { dispose: vi.fn() };
      collection.push(disposable);

      collection.dispose();
      collection.dispose();
      collection.dispose();

      expect(disposable.dispose).toHaveBeenCalledTimes(1);
    });

    it('should clear the internal array after dispose', () => {
      collection.push({ dispose: vi.fn() }, { dispose: vi.fn() });

      collection.dispose();

      expect(collection.size).toBe(0);
    });
  });

  describe('integration', () => {
    it('should work with add and push together', () => {
      const d1 = { dispose: vi.fn() };
      const d2 = { dispose: vi.fn() };
      const d3 = { dispose: vi.fn() };

      collection.add(d1);
      collection.push(d2, d3);

      expect(collection.size).toBe(3);

      collection.dispose();

      expect(d1.dispose).toHaveBeenCalled();
      expect(d2.dispose).toHaveBeenCalled();
      expect(d3.dispose).toHaveBeenCalled();
    });
  });

  describe('LIFO order', () => {
    it('should dispose in reverse order (LIFO)', () => {
      const order: number[] = [];
      const d1 = { dispose: vi.fn(() => order.push(1)) };
      const d2 = { dispose: vi.fn(() => order.push(2)) };
      const d3 = { dispose: vi.fn(() => order.push(3)) };

      collection.push(d1, d2, d3);
      collection.dispose();

      // Should be disposed in reverse order: 3, 2, 1
      expect(order).toEqual([3, 2, 1]);
    });

    it('should maintain LIFO order with mixed add/push', () => {
      const order: number[] = [];
      const d1 = { dispose: vi.fn(() => order.push(1)) };
      const d2 = { dispose: vi.fn(() => order.push(2)) };
      const d3 = { dispose: vi.fn(() => order.push(3)) };

      collection.add(d1);
      collection.push(d2);
      collection.add(d3);
      collection.dispose();

      expect(order).toEqual([3, 2, 1]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty collection dispose without error', () => {
      expect(() => collection.dispose()).not.toThrow();
      expect(collection.size).toBe(0);
    });

    it('should handle single disposable', () => {
      const d1 = { dispose: vi.fn() };
      collection.add(d1);

      collection.dispose();

      expect(d1.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
