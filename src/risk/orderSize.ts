import type { BotConfig } from '@/siobot/BotConfig';

export function capOrderSizeUSDT(
  orderSizeUSDT: number,
  botConfig: Pick<BotConfig, 'riskMaxOrderSizeUSDT'>
): number {
  return Math.min(orderSizeUSDT, botConfig.riskMaxOrderSizeUSDT.value);
}
