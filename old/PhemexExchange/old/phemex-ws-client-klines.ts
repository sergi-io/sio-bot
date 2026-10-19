import type { PhemexWsClient, WsMessageHandler } from '../PhemexWsClient';
import type { PhemexWsKlinesMessage } from './types';

/**
 * Filter klines messages by symbol
 */
function klinesMessageHandlerFilter(
  messageHandler: WsMessageHandler<PhemexWsKlinesMessage>,
  symbol: string
): WsMessageHandler<Uint8Array> {
  return (message: Uint8Array) => {
    try {
      const textDecoder = new TextDecoder();
      const messageText = textDecoder.decode(message);
      const wsKlinesMessage = JSON.parse(messageText) as PhemexWsKlinesMessage;

      if (
        !wsKlinesMessage.symbol ||
        wsKlinesMessage.symbol.toLowerCase() !== symbol.toLowerCase()
      ) {
        // Not the symbol we're interested in, ignore
        return;
      }

      messageHandler(wsKlinesMessage);
    } catch (err) {
      console.error('Impossible to unmarshal message into PhemexWsKlinesMessage:', err);
    }
  };
}

/**
 * Subscribe to klines
 */
export function subscribeKlines(
  client: PhemexWsClient,
  symbol: string,
  interval: number,
  messageHandler: WsMessageHandler<PhemexWsKlinesMessage>,
  debug: boolean = false
): Promise<void> {
  const subscription = {
    id: Date.now() * 1000000,
    method: 'kline_p.subscribe',
    params: [symbol, interval],
  };

  if (debug) {
    console.log(
      `[PhemexWsClient DEBUG] Subscribing to klines for ${symbol} at interval ${interval}`
    );
  }

  client.addMessageHandler(subscription, klinesMessageHandlerFilter(messageHandler, symbol));

  return client.sendMessage(subscription);
}

/**
 * Unsubscribe from klines
 */
export function unsubscribeKlines(
  client: PhemexWsClient,
  symbol: string,
  interval: number,
  debug: boolean = false
): Promise<void> {
  const toSend = {
    id: Date.now() * 1000000,
    method: 'kline_p.unsubscribe',
    params: [symbol, interval],
  };

  if (debug) {
    console.log(
      `[PhemexWsClient DEBUG] Unsubscribing from klines for ${symbol} at interval ${interval}`
    );
  }

  return client.sendMessage(toSend);
}
