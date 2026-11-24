import { ZodError } from 'zod';

/**
 * Validate req.body / req.query / req.params with Zod schemas.
 * Parsed (coerced, defaulted) values are stored on `req.valid` because
 * Express 5 exposes `req.query` as a read-only getter.
 *
 *   router.get('/', validate({ query: listQuerySchema }), handler)
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    req.valid = req.valid || {};
    for (const [source, schema] of Object.entries(schemas)) {
      req.valid[source] = schema.parse(req[source] ?? {});
    }
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      err.status = 400;
    }
    next(err);
  }
};

export default validate;
