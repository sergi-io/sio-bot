import type { ALXTimeFrame } from '@/domain/ALXTimeFrame';

const mappedTimeFrames: Record<ALXTimeFrame, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

export function timeFrameToPhemexInterval(tf: ALXTimeFrame): number {
  const interval = mappedTimeFrames[tf];
  if (interval) {
    return interval;
  }
  throw new Error(`Unsupported timeframe: ${tf}`);
}

export function phemexIntervalToTimeFrame(interval: number): ALXTimeFrame {
  for (const [tf, mappedInterval] of Object.entries(mappedTimeFrames)) {
    if (mappedInterval === interval) {
      return tf as ALXTimeFrame;
    }
  }
  throw new Error(`Unsupported Phemex timeframe interval: ${interval}`);
}
