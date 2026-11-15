/** Copy only the allowed fields from a request body, so clients cannot set anything else (mass assignment). */
export const pick = (body, fields) =>
  Object.fromEntries(
    fields.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]),
  );
