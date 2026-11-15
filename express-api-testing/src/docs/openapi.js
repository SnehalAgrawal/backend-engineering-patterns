import swaggerJsdoc from 'swagger-jsdoc';

const error = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object' },
      },
    },
  },
};
const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: error } },
});

/** OpenAPI 3 document: shared components here, paths from the @openapi comments in src/routes. */
export const openapi = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Users and posts API',
      version: '1.0.0',
      description: 'Example API for backend-engineering-patterns/express-api-testing.',
    },
    components: {
      parameters: {
        Id: {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string' },
          description: 'MongoDB ObjectId',
        },
      },
      schemas: {
        UserInput: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            name: { type: 'string', maxLength: 100 },
            email: { type: 'string', format: 'email' },
          },
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        PostInput: {
          type: 'object',
          required: ['title', 'body', 'userId'],
          properties: {
            title: { type: 'string', maxLength: 200 },
            body: { type: 'string' },
            userId: { type: 'string' },
          },
        },
        Post: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            userId: { oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/User' }] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        BadRequest: errorResponse(
          'Invalid input or id (codes: validation_failed, invalid_id, invalid_json, unknown_user)',
        ),
        NotFound: errorResponse('No such record (code: not_found)'),
        Conflict: errorResponse('A unique field is already taken (code: duplicate)'),
      },
    },
  },
  apis: [new URL('../routes/*.js', import.meta.url).pathname],
});
