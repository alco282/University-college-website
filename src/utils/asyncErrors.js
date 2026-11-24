'use strict';

/**
 * Express 4 does not natively forward rejected promises returned by async
 * middleware/route handlers to the error middleware. The application loads
 * this module before creating the Express app, so patch Express' Layer once
 * and keep the existing route definitions unchanged.
 */
const Layer = require('express/lib/router/layer');

if (!Layer.prototype.__asyncErrorsPatched) {
  const originalHandleRequest = Layer.prototype.handle_request;
  const originalHandleError = Layer.prototype.handle_error;

  Layer.prototype.handle_request = function handle_request(req, res, next) {
    const fn = this.handle;

    if (fn.length > 3) {
      return originalHandleRequest.call(this, req, res, next);
    }

    try {
      const result = fn(req, res, next);

      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype.handle_error = function handle_error(error, req, res, next) {
    const fn = this.handle;

    if (fn.length !== 4) {
      return originalHandleError.call(this, error, req, res, next);
    }

    try {
      const result = fn(error, req, res, next);

      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };

  Object.defineProperty(Layer.prototype, '__asyncErrorsPatched', {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}
