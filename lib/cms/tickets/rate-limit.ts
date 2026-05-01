/**
 * In-memory rate limiter for the public ticket submission endpoint.
 * Tracks submissions per IP address with a sliding window.
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly requests: Map<string, number[]> = new Map();

  constructor(maxRequests: number = 5, windowMs: number = 15 * 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check whether the given IP address is allowed to make a request.
   * Returns true if the IP has fewer than maxRequests within the current window.
   */
  isAllowed(ip: string): boolean {
    this.cleanup(ip);
    const timestamps = this.requests.get(ip);
    if (!timestamps) return true;
    return timestamps.length < this.maxRequests;
  }

  /**
   * Record a request from the given IP address.
   */
  record(ip: string): void {
    const now = Date.now();
    const timestamps = this.requests.get(ip);
    if (timestamps) {
      timestamps.push(now);
    } else {
      this.requests.set(ip, [now]);
    }
  }

  /**
   * Remove expired timestamps for a given IP, and delete the entry
   * entirely if no timestamps remain.
   */
  private cleanup(ip: string): void {
    const timestamps = this.requests.get(ip);
    if (!timestamps) return;

    const cutoff = Date.now() - this.windowMs;
    const valid = timestamps.filter((t) => t > cutoff);

    if (valid.length === 0) {
      this.requests.delete(ip);
    } else {
      this.requests.set(ip, valid);
    }
  }
}
