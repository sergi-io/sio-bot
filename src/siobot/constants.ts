export enum BotState {
  PAUSED = 'PAUSED',
  INITIALIZING = 'INITIALIZING',
  LOOKING_FOR_TRADES = 'LOOKING_FOR_TRADES',
  COOLING_DOWN = 'COOLING_DOWN',
  WARMING_UP = 'WARMING_UP',
  OPTIMIZING = 'OPTIMIZING',
}

export enum BotRunMode {
  LIVE = 'live',
  BACKTEST = 'backtest',
  PAPER_TRADE = 'papertrade',
}
