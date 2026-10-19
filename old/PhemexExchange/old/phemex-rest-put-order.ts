import { APIError } from './common/errors';
import type { PhemexRestClient } from './phemex-rest-client';
import { Request, RequestOption, SecType } from './request-helper';
import type { BaseResponse, PhemexOrderResponse } from './types';

/**
 * PhemexPutOrder - Create order
 */
export class PhemexPutOrder {
  private client: PhemexRestClient;
  private clOrdID?: string;
  private symbol: string = '';
  private reduceOnly?: boolean;
  private closeOnTrigger?: boolean;
  private orderQtyRq?: string;
  private ordType?: string;
  private priceRp?: string;
  private side: string = '';
  private posSide: string = '';
  private text?: string;
  private timeInForce?: string;
  private stopPxRp?: string;
  private takeProfitRp?: string;
  private tpPxRp?: string;
  private stopLossRp?: string;
  private slPxRp?: string;
  private pegOffsetValueRp?: string;
  private pegPriceType?: string;
  private triggerType?: string;
  private tpTrigger?: string;
  private slTrigger?: string;
  private stpInstruction?: string;

  constructor(client: PhemexRestClient) {
    this.client = client;
  }

  setSymbol(symbol: string): this {
    this.symbol = symbol;
    return this;
  }

  setClOrdID(clOrdID: string): this {
    this.clOrdID = clOrdID;
    return this;
  }

  setReduceOnly(reduceOnly: boolean): this {
    this.reduceOnly = reduceOnly;
    return this;
  }

  setCloseOnTrigger(closeOnTrigger: boolean): this {
    this.closeOnTrigger = closeOnTrigger;
    return this;
  }

  setOrderQtyRq(orderQtyRq: string): this {
    this.orderQtyRq = orderQtyRq;
    return this;
  }

  setOrdType(ordType: string): this {
    this.ordType = ordType;
    return this;
  }

  setPriceRp(priceRp: string): this {
    this.priceRp = priceRp;
    return this;
  }

  setSide(side: string): this {
    this.side = side;
    return this;
  }

  setPosSide(posSide: string): this {
    this.posSide = posSide;
    return this;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  setTimeInForce(timeInForce: string): this {
    this.timeInForce = timeInForce;
    return this;
  }

  setStopPxRp(stopPxRp: string): this {
    this.stopPxRp = stopPxRp;
    return this;
  }

  setTakeProfitRp(takeProfitRp: string): this {
    this.takeProfitRp = takeProfitRp;
    return this;
  }

  setTpPxRp(tpPxRp: string): this {
    this.tpPxRp = tpPxRp;
    return this;
  }

  setStopLossRp(stopLossRp: string): this {
    this.stopLossRp = stopLossRp;
    return this;
  }

  setSlPxRp(slPxRp: string): this {
    this.slPxRp = slPxRp;
    return this;
  }

  setPegOffsetValueRp(pegOffsetValueRp: string): this {
    this.pegOffsetValueRp = pegOffsetValueRp;
    return this;
  }

  setPegPriceType(pegPriceType: string): this {
    this.pegPriceType = pegPriceType;
    return this;
  }

  setTriggerType(triggerType: string): this {
    this.triggerType = triggerType;
    return this;
  }

  setTpTrigger(tpTrigger: string): this {
    this.tpTrigger = tpTrigger;
    return this;
  }

  setSlTrigger(slTrigger: string): this {
    this.slTrigger = slTrigger;
    return this;
  }

  setStpInstruction(stpInstruction: string): this {
    this.stpInstruction = stpInstruction;
    return this;
  }

  private async createUpdateOrder(endpoint: string, opts: RequestOption[] = []): Promise<any> {
    const req = new Request();
    req.method = 'POST';
    req.endpoint = endpoint;
    req.secType = SecType.Signed;

    req.setFormParam('symbol', this.symbol);

    if (this.clOrdID !== undefined) {
      req.setFormParam('clOrdID', this.clOrdID);
    }
    if (this.reduceOnly !== undefined) {
      req.setFormParam('reduceOnly', this.reduceOnly);
    }
    if (this.closeOnTrigger !== undefined) {
      req.setFormParam('closeOnTrigger', this.closeOnTrigger);
    }
    if (this.orderQtyRq !== undefined) {
      req.setFormParam('orderQtyRq', this.orderQtyRq);
    }
    if (this.ordType !== undefined) {
      req.setFormParam('ordType', this.ordType);
    }
    if (this.priceRp !== undefined) {
      req.setFormParam('priceRp', this.priceRp);
    }
    if (this.side !== '') {
      req.setFormParam('side', this.side);
    }
    if (this.posSide !== '') {
      req.setFormParam('posSide', this.posSide);
    }
    if (this.text !== undefined) {
      req.setFormParam('text', this.text);
    }
    if (this.timeInForce !== undefined) {
      req.setFormParam('timeInForce', this.timeInForce);
    }
    if (this.stopPxRp !== undefined) {
      req.setFormParam('stopPxRp', this.stopPxRp);
    }
    if (this.takeProfitRp !== undefined) {
      req.setFormParam('takeProfitRp', this.takeProfitRp);
    }
    if (this.tpPxRp !== undefined) {
      req.setFormParam('tpPxRp', this.tpPxRp);
    }
    if (this.stopLossRp !== undefined) {
      req.setFormParam('stopLossRp', this.stopLossRp);
    }
    if (this.slPxRp !== undefined) {
      req.setFormParam('slPxRp', this.slPxRp);
    }
    if (this.pegOffsetValueRp !== undefined) {
      req.setFormParam('pegOffsetValueRp', this.pegOffsetValueRp);
    }
    if (this.pegPriceType !== undefined) {
      req.setFormParam('pegPriceType', this.pegPriceType);
    }
    if (this.triggerType !== undefined) {
      req.setFormParam('triggerType', this.triggerType);
    }
    if (this.tpTrigger !== undefined) {
      req.setFormParam('tpTrigger', this.tpTrigger);
    }
    if (this.slTrigger !== undefined) {
      req.setFormParam('slTrigger', this.slTrigger);
    }
    if (this.stpInstruction !== undefined) {
      req.setFormParam('stpInstruction', this.stpInstruction);
    }

    return await this.client.callAPI(req, opts);
  }

  /**
   * Do send request
   */
  async do(opts: RequestOption[] = []): Promise<PhemexOrderResponse> {
    const data = await this.createUpdateOrder('/g-orders/', opts);
    const resp = data as BaseResponse<PhemexOrderResponse>;

    if (resp.code > 0) {
      throw new APIError(resp.code, resp.msg);
    }

    return resp.data;
  }
}
