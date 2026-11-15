import * as chai from 'chai';
import chaiHttp, { request } from 'chai-http';
import { createApp } from '../src/app.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

chai.use(chaiHttp);
const { expect } = chai;
const app = createApp();
const api = () => request.execute(app);

describe('Users', () => {
  describe('POST /api/users', () => {
    it('creates a user and normalises the email', async () => {
      const res = await api()
        .post('/api/users')
        .send({ name: ' Asha ', email: 'Asha@Example.com' });
      expect(res).to.have.status(201);
      expect(res.body).to.include({ name: 'Asha', email: 'asha@example.com' });
      expect(res.body).to.have.property('_id');
    });

    it('ignores fields the client may not set', async () => {
      const res = await api()
        .post('/api/users')
        .send({ name: 'Ravi', email: 'ravi@example.com', isAdmin: true, createdAt: '2000-01-01' });
      expect(res).to.have.status(201);
      expect(res.body).to.not.have.property('isAdmin');
      expect(new Date(res.body.createdAt).getFullYear()).to.be.greaterThan(2000);
    });

    it('rejects missing fields with a 400 that names them', async () => {
      const res = await api().post('/api/users').send({});
      expect(res).to.have.status(400);
      expect(res.body.error.code).to.equal('validation_failed');
      expect(res.body.error.details).to.have.all.keys('name', 'email');
    });

    it('rejects an invalid email', async () => {
      const res = await api().post('/api/users').send({ name: 'Bad', email: 'not-an-email' });
      expect(res).to.have.status(400);
      expect(res.body.error.details).to.have.property('email');
    });

    it('returns 409 for a duplicate email, whatever its case', async () => {
      await User.create({ name: 'First', email: 'same@example.com' });
      const res = await api()
        .post('/api/users')
        .send({ name: 'Second', email: 'SAME@example.com' });
      expect(res).to.have.status(409);
      expect(res.body.error.code).to.equal('duplicate');
      expect(res.body.error.message).to.not.match(/E11000/); // no database internals in responses
    });
  });

  describe('GET /api/users', () => {
    it('lists users, newest first', async () => {
      await User.create({ name: 'Older', email: 'older@example.com' });
      await User.create({ name: 'Newer', email: 'newer@example.com' });
      const res = await api().get('/api/users');
      expect(res).to.have.status(200);
      expect(res.body.map((u) => u.name)).to.deep.equal(['Newer', 'Older']);
    });
  });

  describe('GET /api/users/:id', () => {
    it('returns the user', async () => {
      const user = await User.create({ name: 'Meera', email: 'meera@example.com' });
      const res = await api().get(`/api/users/${user._id}`);
      expect(res).to.have.status(200);
      expect(res.body).to.include({ _id: user._id.toString(), name: 'Meera' });
    });

    it('returns 404 for an id that does not exist', async () => {
      const res = await api().get('/api/users/65f0c0ffee0000000000abcd');
      expect(res).to.have.status(404);
      expect(res.body.error.code).to.equal('not_found');
    });

    it('returns 400, not 500, for a malformed id', async () => {
      const res = await api().get('/api/users/not-an-id');
      expect(res).to.have.status(400);
      expect(res.body.error.code).to.equal('invalid_id');
    });
  });

  describe('PUT /api/users/:id', () => {
    it('updates the name', async () => {
      const user = await User.create({ name: 'Old', email: 'old@example.com' });
      const res = await api().put(`/api/users/${user._id}`).send({ name: 'New' });
      expect(res).to.have.status(200);
      expect(res.body).to.include({ name: 'New', email: 'old@example.com' });
    });

    it('validates on update, too', async () => {
      const user = await User.create({ name: 'Valid', email: 'valid@example.com' });
      const res = await api().put(`/api/users/${user._id}`).send({ email: 'broken' });
      expect(res).to.have.status(400);
      expect(res.body.error.code).to.equal('validation_failed');
    });

    it("returns 409 when taking another user's email", async () => {
      await User.create({ name: 'A', email: 'a@example.com' });
      const b = await User.create({ name: 'B', email: 'b@example.com' });
      const res = await api().put(`/api/users/${b._id}`).send({ email: 'a@example.com' });
      expect(res).to.have.status(409);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await api().put('/api/users/65f0c0ffee0000000000abcd').send({ name: 'X' });
      expect(res).to.have.status(404);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('deletes the user and their posts', async () => {
      const user = await User.create({ name: 'Leaving', email: 'leaving@example.com' });
      await Post.create([
        { title: 'One', body: '1', userId: user._id },
        { title: 'Two', body: '2', userId: user._id },
      ]);
      const res = await api().delete(`/api/users/${user._id}`);
      expect(res).to.have.status(200);
      expect(res.body).to.deep.equal({ deleted: true, deletedPosts: 2 });
      expect(await Post.countDocuments()).to.equal(0);
    });

    it('returns 404 for an unknown user', async () => {
      const res = await api().delete('/api/users/65f0c0ffee0000000000abcd');
      expect(res).to.have.status(404);
    });
  });
});
