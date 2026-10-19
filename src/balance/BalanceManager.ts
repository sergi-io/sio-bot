export interface BalanceSnapshot {
  total: number;
  locked: number;
  available: number;
  positions: Record<string, number>;
}

export class BalanceManager {
  private totalBalance: number;
  private lockedMargins: Record<string, number> = {}; // positionId -> margin

  constructor(initialBalance?: number) {
    this.totalBalance = initialBalance ?? 0;
  }

  // Core operations
  getAvailableBalance(): number {
    const locked = Object.values(this.lockedMargins).reduce((sum, m) => sum + m, 0);
    return this.totalBalance - locked;
  }

  getTotalBalance(): number {
    return this.totalBalance;
  }

  getLockedBalance(): number {
    return Object.values(this.lockedMargins).reduce((sum, m) => sum + m, 0);
  }

  getLockedMarginForPosition(positionId: string): number | undefined {
    return this.lockedMargins[positionId];
  }

  // Lifecycle
  lockMargin(positionId: string, margin: number): void {
    this.lockedMargins[positionId] = margin;
  }

  releaseMargin(positionId: string, realizedPnl: number): void {
    const lockedMargin = this.lockedMargins[positionId];
    if (!lockedMargin) {
      console.warn(`No locked margin found for position ${positionId}`);
      return;
    }

    // Release margin and apply PnL to total balance
    this.totalBalance += realizedPnl;
    delete this.lockedMargins[positionId];
  }

  updateTotalBalance(newBalance: number): void {
    this.totalBalance = newBalance;
  }

  // Safety
  canAffordMargin(margin: number): boolean {
    return this.getAvailableBalance() >= margin;
  }

  // Debug
  getBalanceSnapshot(): BalanceSnapshot {
    return {
      total: this.totalBalance,
      locked: this.getLockedBalance(),
      available: this.getAvailableBalance(),
      positions: { ...this.lockedMargins },
    };
  }

  // Utility for PhemexExchange sync
  clearLockedMargins(): void {
    this.lockedMargins = {};
  }
}
