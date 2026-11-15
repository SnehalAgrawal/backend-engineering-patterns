import * as chai from 'chai';
import chaiHttp, { request } from 'chai-http';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';

chai.use(chaiHttp);
const { expect } = chai;
const app = createApp();
const api = () => request.execute(app);

describe('App', () => {
  it('answers the health check', async () => {
    const res = await api().get('/health');
    expect(res).to.have.status(200);
    expect(res.body).to.deep.equal({ status: 'ok' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await api().get('/api/nothing-here');
    expect(res).to.have.status(404);
    expect(res.body.error.code).to.equal('not_found');
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const res = await api()
      .post('/api/users')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res).to.have.status(400);
    expect(res.body.error.code).to.equal('invalid_json');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const find = User.find;
    const consoleError = console.error;
    User.find = () => {
      throw new Error('connection pool exhausted at 10.0.0.12:27017');
    };
    console.error = () => {}; // the handler logs the real error; keep test output clean
    try {
      const res = await api().get('/api/users');
      expect(res).to.have.status(500);
      expect(res.body).to.deep.equal({
        error: { code: 'internal_error', message: 'Something went wrong' },
      });
    } finally {
      User.find = find;
      console.error = consoleError;
    }
  });

  it('documents every route in the OpenAPI spec', async () => {
    const res = await api().get('/api/docs.json');
    expect(res).to.have.status(200);
    const documented = Object.entries(res.body.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((key) => key !== 'parameters')
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented).to.have.members([
      'POST /api/users',
      'GET /api/users',
      'GET /api/users/{id}',
      'PUT /api/users/{id}',
      'DELETE /api/users/{id}',
      'POST /api/posts',
      'GET /api/posts',
      'GET /api/posts/{id}',
      'PUT /api/posts/{id}',
      'DELETE /api/posts/{id}',
    ]);
  });

  it('serves the Swagger UI', async () => {
    const res = await api().get('/api/docs/');
    expect(res).to.have.status(200);
    expect(res.text).to.match(/swagger-ui/i);
  });
});
