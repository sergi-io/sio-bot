// Security types
export enum SecType {
  None,
  APIKey,
  Signed, // if the 'timestamp' parameter is required
}

// Params type
export type Params = Record<string, any>;

// Request class
export class Request {
  method: string;
  endpoint: string;
  query: URLSearchParams;
  form: Record<string, any>;
  recvWindow: number;
  secType: SecType;
  header: Headers;
  body?: string;
  fullURL?: string;

  constructor() {
    this.method = "GET";
    this.endpoint = "";
    this.query = new URLSearchParams();
    this.form = {};
    this.recvWindow = 0;
    this.secType = SecType.None;
    this.header = new Headers();
  }

  // Set param with key/value to query string
  setParam(key: string, value: any): this {
    this.query.set(key, String(value));
    return this;
  }

  // Set params with key/values to query string
  setParams(params: Params): this {
    for (const [key, value] of Object.entries(params)) {
      this.setParam(key, value);
    }
    return this;
  }

  // Set param with key/value to request form body
  setFormParam(key: string, value: any): this {
    this.form[key] = value;
    return this;
  }

  // Set params with key/values to request form body
  setFormParams(params: Params): this {
    for (const [key, value] of Object.entries(params)) {
      this.setFormParam(key, value);
    }
    return this;
  }

  validate(): void {
    // Validation logic (if needed)
  }
}

// Request option type
export type RequestOption = (req: Request) => void;

// WithRecvWindow set recvWindow param for the request
export function withRecvWindow(recvWindow: number): RequestOption {
  return (req: Request) => {
    req.recvWindow = recvWindow;
  };
}
