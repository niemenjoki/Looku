// A bad request (range, dimension, interval, filter); the API answers 400.
export class ReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportError";
  }
}
