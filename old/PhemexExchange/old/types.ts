// Exchange margin types
export enum ExchangeMarginType {
  BTCToWallet = 1,
  WalletToBTC = 2,
  WalletToUSD = 3,
  USDToWallet = 4,
}

// Side types
export enum PhemexSideType {
  Buy = 'Buy',
  Sell = 'Sell',
}

// Order types
export enum PhemexOrderType {
  Limit = 'Limit',
  Market = 'Market',
  Stop = 'Stop',
  StopLimit = 'StopLimit',
  MarketIfTouched = 'MarketIfTouched',
  LimitIfTouched = 'LimitIfTouched',
  Pegged = 'Pegged',
}

// Time in force types
export enum TimeInForceType {
  Day = 'Day',
  GoodTillCancel = 'GoodTillCancel',
  ImmediateOrCancel = 'ImmediateOrCancel',
  FillOrKill = 'FillOrKill',
}

// Trigger types
export enum TriggerType {
  ByMarkPrice = 'ByMarkPrice',
  ByLastPrice = 'ByLastPrice',
}

// Constants
export const SIGNATURE_KEY = 'x-phemex-request-signature';
export const EXPIRY_KEY = 'x-phemex-request-expiry';
export const ACCESS_TOKEN_KEY = 'x-phemex-access-token';

// Order response interface
export interface PhemexOrderResponse {
  bizError: number;
  orderID: string;
  clOrdID: string;
  symbol: string;
  side: PhemexSideType;
  actionTimeNs: number;
  transactTimeNs: number;
  orderType: PhemexOrderType;
  priceEp: number;
  price: number;
  orderQty: number;
  displayQty: number;
  timeInForce: TimeInForceType;
  reduceOnly: boolean;
  takeProfitEp: number;
  takeProfit: number;
  stopPxEp: number;
  stopPx: number;
  stopLossEp: number;
  closedPnlEv: number;
  closedPnl: number;
  closedSize: number;
  cumQty: number;
  cumValueEv: number;
  cumValue: number;
  leavesQty: number;
  leavesValueEv: number;
  leavesValue: number;
  stopLoss: number;
  stopDirection: string;
  ordStatus: string;
  trigger: string;
}

// Account position interface
export interface PhemexAccountPosition {
  account: PhemexAccount;
  positions: PhemexPosition[];
}

// Account detail interface
export interface PhemexAccount {
  accountId: number;
  currency: string;
  accountBalanceRv: string;
  totalUsedBalanceRv: string;
}

// Position detail interface
export interface PhemexPosition {
  accountID: number;
  symbol: string;
  currency: string;
  side: string;
  positionStatus: string;
  crossMargin: boolean;
  leverageEr: number;
  leverage: number;
  initMarginReqEr: number;
  initMarginReq: number;
  maintMarginReqEr: number;
  maintMarginReq: number;
  riskLimitEv: number;
  riskLimit: number;
  size: string;
  value: number;
  valueEv: number;
  avgEntryPriceEp: string;
  avgEntryPrice: string;
  posCostEv: number;
  posCost: number;
  assignedPosBalanceEv: number;
  assignedPosBalance: number;
  bankruptCommEv: number;
  bankruptComm: number;
  bankruptPriceEp: number;
  bankruptPrice: number;
  positionMarginEv: number;
  positionMargin: number;
  liquidationPriceEp: number;
  liquidationPrice: number;
  deleveragePercentileEr: number;
  deleveragePercentile: number;
  buyValueToCostEr: number;
  buyValueToCost: number;
  sellValueToCostEr: number;
  sellValueToCost: number;
  markPriceEp: number;
  markPrice: number;
  markValueEv: number;
  markValue: number;
  unRealisedPosLossEv: number;
  unRealisedPosLoss: number;
  estimatedOrdLossEv: number;
  estimatedOrdLoss: number;
  usedBalanceEv: number;
  usedBalance: number;
  takeProfitEp: number;
  takeProfit: number;
  stopLossEp: number;
  stopLoss: number;
  realisedPnlEv: number;
  realisedPnl: number;
  cumRealisedPnlEv: number;
  cumRealisedPnl: number;
}

// Base response interface
export interface BaseResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

// Rows order response
export interface RowsOrderResponse {
  rows: PhemexOrderResponse[];
}

// WebSocket klines message
export interface PhemexWsKlinesMessage {
  kline_p: any[][];
  symbol: string;
  sequence: number;
  type: 'snapshot' | 'incremental';
}

// WebSocket account message
export interface PhemexWsAccount {
  accountBalanceEv: number;
  accountID: number;
  bonusBalanceEv: number;
  currency: string;
  totalUsedBalanceEv: number;
  userID: number;
}

// WebSocket order message
export interface PhemexWsOrder {
  accountID: number;
  action: string;
  actionBy: string;
  actionTimeNs: number;
  addedSeq: number;
  bonusChangedAmountEv: number;
  clOrdID: string;
  closedPnlEv: number;
  closedSize: number;
  code: number;
  cumQty: number;
  cumValueEv: number;
  curAccBalanceEv: number;
  curAssignedPosBalanceEv: number;
  curBonusBalanceEv: number;
  curLeverageEr: number;
  curPosSide: string;
  curPosSize: number;
  curPosTerm: number;
  curPosValueEv: number;
  curRiskLimitEv: number;
  currency: string;
  cxlRejReason: number;
  displayQty: number;
  execFeeEv: number;
  execID: string;
  execInst: string;
  execPriceEp: number;
  execQty: number;
  execSeq: number;
  execStatus: string;
  execValueEv: number;
  feeRateEr: number;
  lastLiquidityInd: string;
  leavesQty: number;
  leavesValueEv: number;
  message: string;
  ordStatus: string;
  ordType: string;
  orderID: string;
  orderQty: number;
  pegOffsetValueEp: number;
  platform: string;
  priceEp: number;
  relatedPosTerm: number;
  relatedReqNum: number;
  side: string;
  stopDirection: string;
  stopLossEp: number;
  stopPxEp: number;
  symbol: string;
  takeProfitEp: number;
  timeInForce: string;
  tradeType: string;
  transactTimeNs: number;
  userID: number;
}

// WebSocket position message
export interface PhemexWsPosition {
  accountID: number;
  assignedPosBalanceRv: string;
  avgEntryPriceRp: string;
  bankruptCommRv: string;
  bankruptPriceRp: string;
  buyLeavesQty: string;
  buyLeavesValueRv: string;
  buyValueToCostRr: string;
  createdAtNs: number;
  crossSharedBalanceRv: string;
  cumClosedPnlRv: string;
  cumFundingFeeRv: string;
  cumPtFeeRv: string;
  cumTransactFeeRv: string;
  curTermRealisedPnlRv: string;
  currency: string;
  dataVer: number;
  deleveragePercentileRr: string;
  displayLeverageRr: string;
  estimatedOrdLossRv: string;
  execSeq: number;
  freeCostRv: string;
  freeQty: string;
  initMarginReqRr: string;
  lastFundingTime: number;
  lastTermEndTime: number;
  leverageRr: string;
  liquidationPriceRp: string;
  maintMarginReqRr: string;
  makerFeeRateRr: string;
  markPriceRp: string;
  minPosCostRv: string;
  orderCostRv: string;
  posCostRv: string;
  posMode: string;
  posSide: string;
  positionMarginRv: string;
  positionStatus: string;
  riskLimitRv: string;
  sellLeavesQty: string;
  sellLeavesValueRv: string;
  sellValueToCostRr: string;
  side: string;
  size: string;
  symbol: string;
  takerFeeRateRr: string;
  term: number;
  transactTimeNs: number;
  unrealisedPnlRv: string;
  updatedAtNs: number;
  usedBalanceRv: string;
  userID: number;
  valueRv: string;
}

// WebSocket AOP message
export interface PhemexWsAOPMessage {
  accounts_p: PhemexWsAccount[];
  orders_p: PhemexWsOrder[];
  positions_p: PhemexWsPosition[];
  sequence: number;
  timestamp: number;
  type: 'snapshot' | 'incremental';
}
