// APIError class for handling API errors (4xx or 5xx responses)
export class APIError extends Error {
  public code: number;
  public data: string;

  constructor(code: number, message: string, data: string = "") {
    super(message);
    this.name = "APIError";
    this.code = code;
    this.data = data;
  }

  toString(): string {
    return `<APIError> code=${this.code}, msg=${this.message}, data=${this.data}`;
  }
}

// Check if an error is an APIError
export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError;
}
