import type { ALXTimeFrame } from './ALXTimeFrame';

export type ALXKline = {
  type: 'full' | 'delta'; // Indicates if the kline is complete or still partial
  pair: string; // Trading pair, e.g., "BTC/USD"
  timeframe: ALXTimeFrame; // Timeframe, e.g., "1m", "5m", "1h"
  timestamp: number; // Timestamp in milliseconds
  open: number; // Open price
  high: number; // High price
  low: number; // Low price
  close: number; // Close price
  buyCost: number;
  sellCost: number;
  buyVolume: number; // Buy volume
  sellVolume: number; // Sell volume
  liqBuyCost: number;
  liqSellCost: number;
  liqBuyVolume: number;
  liqSellVolume: number;
  tradeCount: number;
  liqCount: number;
};
