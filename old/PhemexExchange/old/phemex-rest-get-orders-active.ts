import { APIError } from './common/errors';
import type { PhemexRestClient } from './phemex-rest-client';
import { Request, RequestOption, SecType } from './request-helper';
import type { BaseResponse, PhemexOrderResponse, RowsOrderResponse } from './types';

/**
 * PhemexGetOrdersActive - List opened orders
 */
export class PhemexGetOrdersActive {
  private client: PhemexRestClient;
  private symbol: string = '';

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
   * Do send request
   */
  async do(opts: RequestOption[] = []): Promise<PhemexOrderResponse[]> {
    const req = new Request();
    req.method = 'GET';
    req.endpoint = '/g-orders/activeList';
    req.secType = SecType.Signed;

    if (this.symbol !== '') {
      req.setParam('symbol', this.symbol);
    }

    const data = await this.client.callAPI(req, opts);
    const resp = data as BaseResponse<RowsOrderResponse>;

    if (resp.code > 0) {
      throw new APIError(resp.code, resp.msg);
    }

    return resp.data.rows;
  }
}
