import * as chai from 'chai';
import chaiHttp, { request } from 'chai-http';
import { createApp } from '../src/app.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

chai.use(chaiHttp);
const { expect } = chai;
const app = createApp();
const api = () => request.execute(app);

describe('Posts', () => {
  let author;
  beforeEach(async () => {
    author = await User.create({ name: 'Author', email: 'author@example.com' });
  });

  describe('POST /api/posts', () => {
    it('creates a post', async () => {
      const res = await api()
        .post('/api/posts')
        .send({ title: 'Hello', body: 'First post', userId: author._id });
      expect(res).to.have.status(201);
      expect(res.body).to.include({ title: 'Hello', userId: author._id.toString() });
    });

    it('rejects missing fields with a 400 that names them', async () => {
      const res = await api().post('/api/posts').send({});
      expect(res).to.have.status(400);
      expect(res.body.error.details).to.have.all.keys('title', 'body', 'userId');
    });

    it('rejects a post for a user that does not exist', async () => {
      const res = await api()
        .post('/api/posts')
        .send({ title: 'T', body: 'B', userId: '65f0c0ffee0000000000abcd' });
      expect(res).to.have.status(400);
      expect(res.body.error.code).to.equal('unknown_user');
    });

    it('rejects a malformed userId', async () => {
      const res = await api().post('/api/posts').send({ title: 'T', body: 'B', userId: 'nope' });
      expect(res).to.have.status(400);
      expect(res.body.error.details).to.have.property('userId');
    });
  });

  describe('GET /api/posts', () => {
    it('lists posts with their author, and filters by user', async () => {
      const other = await User.create({ name: 'Other', email: 'other@example.com' });
      await Post.create({ title: 'Mine', body: 'b', userId: author._id });
      await Post.create({ title: 'Theirs', body: 'b', userId: other._id });

      const all = await api().get('/api/posts');
      expect(all.body).to.have.length(2);
      expect(all.body[0].userId).to.include({ name: 'Other', email: 'other@example.com' });

      const mine = await api().get('/api/posts').query({ userId: author._id.toString() });
      expect(mine.body.map((p) => p.title)).to.deep.equal(['Mine']);
    });

    it('returns 400 for a malformed userId filter', async () => {
      const res = await api().get('/api/posts').query({ userId: 'nope' });
      expect(res).to.have.status(400);
    });
  });

  describe('GET /api/posts/:id', () => {
    it('returns the post with its author', async () => {
      const post = await Post.create({ title: 'Read me', body: 'b', userId: author._id });
      const res = await api().get(`/api/posts/${post._id}`);
      expect(res).to.have.status(200);
      expect(res.body.userId).to.include({ name: 'Author' });
    });

    it('returns 404 for an unknown post', async () => {
      const res = await api().get('/api/posts/65f0c0ffee0000000000abcd');
      expect(res).to.have.status(404);
    });
  });

  describe('PUT /api/posts/:id', () => {
    it('updates the title but never the author', async () => {
      const other = await User.create({ name: 'Other', email: 'other@example.com' });
      const post = await Post.create({ title: 'Before', body: 'b', userId: author._id });
      const res = await api()
        .put(`/api/posts/${post._id}`)
        .send({ title: 'After', userId: other._id });
      expect(res).to.have.status(200);
      expect(res.body).to.include({ title: 'After', userId: author._id.toString() });
    });

    it('rejects an empty title', async () => {
      const post = await Post.create({ title: 'Keep', body: 'b', userId: author._id });
      const res = await api().put(`/api/posts/${post._id}`).send({ title: '' });
      expect(res).to.have.status(400);
    });

    it('returns 404 for an unknown post', async () => {
      const res = await api().put('/api/posts/65f0c0ffee0000000000abcd').send({ title: 'X' });
      expect(res).to.have.status(404);
    });
  });

  describe('DELETE /api/posts/:id', () => {
    it('deletes the post, then reports it gone', async () => {
      const post = await Post.create({ title: 'Bye', body: 'b', userId: author._id });
      expect(await api().delete(`/api/posts/${post._id}`)).to.have.status(200);
      expect(await api().delete(`/api/posts/${post._id}`)).to.have.status(404);
    });
  });
});
