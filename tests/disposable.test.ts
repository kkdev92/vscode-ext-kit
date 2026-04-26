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

  describe('error handling during dispose', () => {
    it('should dispose remaining items when one throws', () => {
      const error = new Error('boom');
      const d1 = { dispose: vi.fn() };
      const d2 = {
        dispose: vi.fn(() => {
          throw error;
        }),
      };
      const d3 = { dispose: vi.fn() };
      collection.push(d1, d2, d3);

      expect(() => collection.dispose()).toThrow(error);

      // All disposables called despite the middle one throwing (LIFO: d3, d2, d1)
      expect(d1.dispose).toHaveBeenCalledTimes(1);
      expect(d2.dispose).toHaveBeenCalledTimes(1);
      expect(d3.dispose).toHaveBeenCalledTimes(1);
    });

    it('should rethrow a single error directly', () => {
      const error = new Error('single failure');
      collection.push({
        dispose: vi.fn(() => {
          throw error;
        }),
      });

      expect(() => collection.dispose()).toThrow(error);
    });

    it('should aggregate multiple errors into AggregateError', () => {
      const e1 = new Error('first');
      const e2 = new Error('second');
      collection.push(
        {
          dispose: vi.fn(() => {
            throw e1;
          }),
        },
        {
          dispose: vi.fn(() => {
            throw e2;
          }),
        }
      );

      let caught: unknown;
      try {
        collection.dispose();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AggregateError);
      const aggregate = caught as AggregateError;
      // LIFO order means e2 was thrown first
      expect(aggregate.errors).toContain(e1);
      expect(aggregate.errors).toContain(e2);
      expect(aggregate.errors).toHaveLength(2);
    });

    it('should mark collection as disposed even if errors occur', () => {
      collection.push({
        dispose: vi.fn(() => {
          throw new Error('fail');
        }),
      });

      expect(() => collection.dispose()).toThrow();

      // Subsequent add should throw because collection is marked disposed
      expect(() => collection.add({ dispose: vi.fn() })).toThrow(
        'Cannot add to a disposed DisposableCollection'
      );
      expect(collection.size).toBe(0);
    });
  });
});
