/** An error with a spec-defined HTTP status and the `Error` body shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Machine-readable `error` code, for the few answers a client acts on. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message = "Invalid request.") {
    return new ApiError(400, message);
  }
  static unauthorized(message = "Not signed in.") {
    return new ApiError(401, message);
  }
  static forbidden(message: string) {
    return new ApiError(403, message);
  }
  static notFound(message: string) {
    return new ApiError(404, message);
  }
  static conflict(message: string) {
    return new ApiError(409, message);
  }
  static tooManyRequests(message: string) {
    return new ApiError(429, message);
  }
  static gone(message: string, code: string) {
    return new ApiError(410, message, code);
  }
}
