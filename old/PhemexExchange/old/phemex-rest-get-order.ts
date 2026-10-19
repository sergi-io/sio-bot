import { APIError } from './common/errors';
import type { PhemexRestClient } from './phemex-rest-client';
import { Request, RequestOption, SecType } from './request-helper';
import type { BaseResponse, PhemexOrderResponse } from './types';

/**
 * PhemexGetOrder - Get an order
 */
export class PhemexGetOrder {
  private client: PhemexRestClient;
  private symbol: string = '';
  private orderID?: string;
  private clOrderID?: string;

  constructor(client: PhemexRestClient) {
    this.client = client;
  }

  /**
   * Set symbol
   */
  setSymbol(symbol: string): this {
    this.symbol = symbol;
    return this;
  }

  /**
   * Set orderID
   */
  setOrderID(orderID: string): this {
    this.orderID = orderID;
    return this;
  }

  /**
   * Set clOrderID
   */
  setClOrderID(clOrderID: string): this {
    this.clOrderID = clOrderID;
    return this;
  }

  /**
   * Do send request
   */
  async do(opts: RequestOption[] = []): Promise<PhemexOrderResponse[]> {
    const req = new Request();
    req.method = 'GET';
    req.endpoint = '/exchange/order';
    req.secType = SecType.Signed;

    req.setParam('symbol', this.symbol);
    if (this.orderID) {
      req.setParam('orderID', this.orderID);
    }
    if (this.clOrderID) {
      req.setParam('clOrderID', this.clOrderID);
    }

    const data = await this.client.callAPI(req, opts);
    const resp = data as BaseResponse<PhemexOrderResponse[]>;

    if (resp.code > 0) {
      throw new APIError(resp.code, resp.msg);
    }

    return resp.data;
  }
}
