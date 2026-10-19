// Main export file for Phemex Exchange TypeScript SDK
export { PhemexExchange } from './phemexExchange';
export { PhemexRestClient } from './phemex-rest-client';
export { PhemexWsClient } from '../PhemexWsClient';

// Export all types
export * from './types';

// Export utilities
export { klineNormalizer as klineParser } from './phemexutils/klineNormalizer';
export { signStringRequest } from './phemexutils/sign-string-request';

// Export error handling
export { APIError, isAPIError } from './common/errors';

// Export WebSocket subscription functions
export { subscribeKlines, unsubscribeKlines } from './phemex-ws-client-klines';
export { subscribeAOP, unsubscribeAOP } from './phemex-ws-client-aop';
