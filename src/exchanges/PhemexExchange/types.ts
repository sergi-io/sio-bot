// WebSocket klines message
export interface PhemexWsKlinesMessage {
  kline_p: any[][];
  symbol: string;
  sequence: number;
  type: 'snapshot' | 'incremental';
}
