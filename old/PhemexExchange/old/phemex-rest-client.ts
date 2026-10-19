import { APIError } from "./common/errors";
import { signStringRequest } from "./phemexutils/sign-string-request";
import { Request, RequestOption, SecType } from "./request-helper";
import { 
  BaseResponse, 
  SIGNATURE_KEY, 
  EXPIRY_KEY, 
  ACCESS_TOKEN_KEY 
} from "./types";

// Forward declarations for service classes
import { PhemexRestGetAccount } from "./phemex-rest-get-account";
import { PhemexGetOrdersActive } from "./phemex-rest-get-orders-active";
import { PhemexGetOrder } from "./phemex-rest-get-order";
import { PhemexRestCancelOrder } from "./phemex-rest-cancel-order";
import { PhemexPutOrder } from "./phemex-rest-put-order";

/**
 * Get current timestamp in seconds
 */
function currentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert object to JSON string
 */
function toJSON(obj: any): string {
  const json = JSON.stringify(obj);
  return json === "{}" ? "" : json;
}

/**
 * PhemexRestClient - REST API client for Phemex
 */
export class PhemexRestClient {
  private apiKey: string;
  private secretKey: string;
  private baseURL: string;
  private userAgent: string;
  private debug: boolean;

  constructor(apiKey: string, secretKey: string, debug: boolean = false) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseURL = "https://api.phemex.com";
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.127 Safari/537.36";
    this.debug = debug;
  }

  /**
   * Debug logging
   */
  private debugLog(message: string, ...args: any[]): void {
    if (this.debug) {
      console.log(`[PhemexRestClient DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Parse and prepare the request
   */
  private async parseRequest(req: Request, opts: RequestOption[] = []): Promise<void> {
    // Set request options from user
    for (const opt of opts) {
      opt(req);
    }

    req.validate();

    const fullURL = `${this.baseURL}${req.endpoint}`;
    const queryString = req.query.toString();
    const bodyString = toJSON(req.form);
    const header = new Headers();

    this.debugLog("BODY", bodyString);

    if (bodyString !== "") {
      req.body = bodyString;
      header.set("content-type", "application/json");
    }

    if (req.secType === SecType.APIKey || req.secType === SecType.Signed) {
      header.set(ACCESS_TOKEN_KEY, this.apiKey);
    }

    const expiry = String(currentTimestamp() + 60 * 2);
    if (req.secType === SecType.Signed) {
      header.set(EXPIRY_KEY, expiry);
    }

    if (req.secType === SecType.Signed) {
      const raw = `${req.endpoint}${queryString}${expiry}${bodyString}`;
      this.debugLog("Signature raw:", raw);
      
      const signedString = await signStringRequest(raw, this.secretKey);
      header.set(SIGNATURE_KEY, signedString);
    }

    req.fullURL = queryString !== "" ? `${fullURL}?${queryString}` : fullURL;
    req.header = header;

    this.debugLog("Headers:", Object.fromEntries(header.entries()));
    this.debugLog("Full URL:", req.fullURL, "Body:", bodyString);
  }

  /**
   * Call the API using Bun fetch
   */
  async callAPI(req: Request, opts: RequestOption[] = []): Promise<any> {
    this.debugLog("Request:", req);

    await this.parseRequest(req, opts);

    if (!req.fullURL) {
      throw new Error("Request URL not set");
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers: req.header,
    };

    if (req.body) {
      fetchOptions.body = req.body;
    }

    this.debugLog("Fetch request:", req.fullURL, fetchOptions);

    const response = await fetch(req.fullURL, fetchOptions);
    const data = await response.text();

    this.debugLog("Response status:", response.status);
    this.debugLog("Response body:", data);

    if (response.status >= 400) {
      let apiErr: APIError;
      try {
        const errorData = JSON.parse(data);
        apiErr = new APIError(errorData.code || response.status, errorData.msg || response.statusText, errorData.data || "");
      } catch (e) {
        apiErr = new APIError(response.status, response.statusText, data);
      }
      throw apiErr;
    }

    return JSON.parse(data);
  }

  /**
   * Service factory methods
   */
  getAccount(): PhemexRestGetAccount {
    return new PhemexRestGetAccount(this);
  }

  getOrdersActive(): PhemexGetOrdersActive {
    return new PhemexGetOrdersActive(this);
  }

  getOrder(): PhemexGetOrder {
    return new PhemexGetOrder(this);
  }

  cancelOrder(): PhemexRestCancelOrder {
    return new PhemexRestCancelOrder(this);
  }

  putOrder(): PhemexPutOrder {
    return new PhemexPutOrder(this);
  }
}
