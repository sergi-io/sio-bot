import ansis from 'ansis';

type FormatMoneyOptions = {
  currency: string;
  colorize: boolean;
  withIcon: boolean;
  decimalsPlaces?: number;
};

export function formatMoney(amount: number, options?: Partial<FormatMoneyOptions>): string {
  const defaultOptions: FormatMoneyOptions = {
    currency: 'USD',
    colorize: true,
    withIcon: true,
    decimalsPlaces: 2,
  };

  options = { ...defaultOptions, ...options };

  const money = Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: options.currency,
    minimumFractionDigits: options.decimalsPlaces,
    maximumFractionDigits: options.decimalsPlaces,
  }).format(amount);
  if (options.colorize) {
    if (amount > 0) {
      return `${options.withIcon ? '💵' : ''} ${ansis.green(money)}`;
    } else if (amount < 0) {
      return `${options.withIcon ? '💵' : ''} ${ansis.red(money)}`;
    }
  }
  return `${options.withIcon ? '💵' : ''} ${money}`;
}
