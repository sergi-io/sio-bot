import type { PhemexWsClient, WsMessageHandler } from '../PhemexWsClient';
import type { PhemexWsAOPMessage } from './types';

/**
 * Filter AOP messages
 */
function aopMessageHandlerFilter(
  messageHandler: WsMessageHandler<PhemexWsAOPMessage>
): WsMessageHandler<Uint8Array> {
  return (message: Uint8Array) => {
    try {
      const textDecoder = new TextDecoder();
      const messageText = textDecoder.decode(message);
      const aopMessage = JSON.parse(messageText) as PhemexWsAOPMessage;

      messageHandler(aopMessage);
    } catch (err) {
      console.error('Impossible to unmarshal message into PhemexWsAOPMessage:', err);
    }
  };
}

/**
 * Subscribe to AOP (Account Order Position) updates
 */
export function subscribeAOP(
  client: PhemexWsClient,
  messageHandler: WsMessageHandler<PhemexWsAOPMessage>,
  debug: boolean = false
): Promise<void> {
  const subscription = {
    id: Date.now() * 1000000,
    method: 'aop_p.subscribe',
    params: [],
  };

  if (debug) {
    console.log(`[PhemexWsClient DEBUG] Subscribing to AOP updates`);
  }

  client.addMessageHandler(subscription, aopMessageHandlerFilter(messageHandler));

  return client.sendMessage(subscription);
}

/**
 * Unsubscribe from AOP updates
 */
export function unsubscribeAOP(client: PhemexWsClient, debug: boolean = false): Promise<void> {
  const toSend = {
    id: Date.now() * 1000000,
    method: 'aop_p.unsubscribe',
    params: [],
  };

  if (debug) {
    console.log(`[PhemexWsClient DEBUG] Unsubscribing from AOP updates`);
  }

  return client.sendMessage(toSend);
}
