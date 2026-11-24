const { ZodError } = require('zod');

/**
 * Higher-order middleware to strictly validate incoming requests against a Zod schema.
 * 
 * @param {object} schemas
 * @param {import('zod').ZodSchema} [schemas.body] - Schema for req.body
 * @param {import('zod').ZodSchema} [schemas.query] - Schema for req.query
 * @param {import('zod').ZodSchema} [schemas.params] - Schema for req.params
 */
function validateRequest(schemas) {
  return async (req, res, next) => {
    try {
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Field names and Zod messages describe the internal schema (allowed
        // enum values, regexes, limits): log them server-side only.
        console.warn(`[VALIDATION]: ${req.method} ${req.originalUrl} rejected:`,
          error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(' | '));
        return res.status(400).json({ error: 'The submitted data is not valid. Please check the form and try again.' });
      }
      return res.status(500).json({ error: 'Internal schema validation error.' });
    }
  };
}

module.exports = {
  validateRequest
};