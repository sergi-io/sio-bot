import { APIError } from './common/errors';
import type { PhemexRestClient } from './phemex-rest-client';
import { Request, RequestOption, SecType } from './request-helper';
import type { PhemexAccountPosition, BaseResponse } from './types';

/**
 * PhemexRestGetAccount - Get account info
 */
export class PhemexRestGetAccount {
  private client: PhemexRestClient;
  private currency: string = 'USDT';

  constructor(client: PhemexRestClient) {
    this.client = client;
  }

  /**
   * Set currency
   */
  setCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  /**
   * Do send request
   */
  async do(opts: RequestOption[] = []): Promise<PhemexAccountPosition> {
    const req = new Request();
    req.method = 'GET';
    req.endpoint = '/g-accounts/positions';
    req.secType = SecType.Signed;

    req.setParam('currency', this.currency);

    const data = await this.client.callAPI(req, opts);
    const resp = data as BaseResponse<PhemexAccountPosition>;

    if (resp.code !== 0) {
      throw new APIError(resp.code, resp.msg);
    }

    // Parse accountBalanceRv as a number
    if (typeof resp.data.account.accountBalanceRv === 'string') {
      (resp.data.account as any).accountBalanceRv = parseFloat(resp.data.account.accountBalanceRv);
    }
    if (typeof resp.data.account.totalUsedBalanceRv === 'string') {
      (resp.data.account as any).totalUsedBalanceRv = parseFloat(
        resp.data.account.totalUsedBalanceRv
      );
    }

    return resp.data;
  }
}
