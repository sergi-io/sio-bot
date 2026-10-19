import { describe, expect, test } from 'bun:test';
import { BalanceManager } from './BalanceManager';

describe('BalanceManager', () => {
  test('should initialize with correct balance', () => {
    const bm = new BalanceManager(1000);
    expect(bm.getTotalBalance()).toBe(1000);
    expect(bm.getAvailableBalance()).toBe(1000);
    expect(bm.getLockedBalance()).toBe(0);
  });

  test('should lock margin and reduce available balance', () => {
    const bm = new BalanceManager(1000);
    bm.lockMargin('pos1', 300);

    expect(bm.getTotalBalance()).toBe(1000);
    expect(bm.getAvailableBalance()).toBe(700);
    expect(bm.getLockedBalance()).toBe(300);
  });

  test('should lock multiple margins cumulatively', () => {
    const bm = new BalanceManager(1000);
    bm.lockMargin('pos1', 300);
    bm.lockMargin('pos2', 200);
    bm.lockMargin('pos3', 100);

    expect(bm.getAvailableBalance()).toBe(400);
    expect(bm.getLockedBalance()).toBe(600);
  });

  test('should release margin with profit', () => {
    const bm = new BalanceManager(1000);
    bm.lockMargin('pos1', 300);
    bm.releaseMargin('pos1', 50); // +50 profit

    expect(bm.getTotalBalance()).toBe(1050);
    expect(bm.getAvailableBalance()).toBe(1050);
    expect(bm.getLockedBalance()).toBe(0);
  });

  test('should release margin with loss', () => {
    const bm = new BalanceManager(1000);
    bm.lockMargin('pos1', 300);
    bm.releaseMargin('pos1', -150); // -150 loss

    expect(bm.getTotalBalance()).toBe(850);
    expect(bm.getAvailableBalance()).toBe(850);
    expect(bm.getLockedBalance()).toBe(0);
  });

  test('should handle multiple position lifecycle', () => {
    const bm = new BalanceManager(1000);

    // Open 3 positions
    bm.lockMargin('pos1', 300);
    bm.lockMargin('pos2', 200);
    bm.lockMargin('pos3', 100);
    expect(bm.getAvailableBalance()).toBe(400);

    // Close pos2 with profit
    bm.releaseMargin('pos2', 50);
    expect(bm.getAvailableBalance()).toBe(650); // 400 + 200 + 50
    expect(bm.getTotalBalance()).toBe(1050);

    // Close pos1 with loss
    bm.releaseMargin('pos1', -100);
    expect(bm.getAvailableBalance()).toBe(850); // 650 + 300 - 100
    expect(bm.getTotalBalance()).toBe(950);

    // pos3 still locked
    expect(bm.getLockedBalance()).toBe(100);
  });

  test('should warn when releasing non-existent position', () => {
    const bm = new BalanceManager(1000);
    // Should not throw, just warn
    expect(() => bm.releaseMargin('pos999', 50)).not.toThrow();
  });

  test('canAffordMargin should check available balance', () => {
    const bm = new BalanceManager(1000);

    expect(bm.canAffordMargin(500)).toBe(true);
    expect(bm.canAffordMargin(1000)).toBe(true);
    expect(bm.canAffordMargin(1001)).toBe(false);

    bm.lockMargin('pos1', 700);
    expect(bm.canAffordMargin(300)).toBe(true);
    expect(bm.canAffordMargin(301)).toBe(false);
  });

  test('getBalanceSnapshot should return complete state', () => {
    const bm = new BalanceManager(1000);
    bm.lockMargin('pos1', 300);
    bm.lockMargin('pos2', 200);

    const snapshot = bm.getBalanceSnapshot();
    expect(snapshot.total).toBe(1000);
    expect(snapshot.locked).toBe(500);
    expect(snapshot.available).toBe(500);
    expect(snapshot.positions).toEqual({ pos1: 300, pos2: 200 });
  });
});
