// Mocha root hooks (loaded through .mocharc.json): one MongoDB for the whole run, emptied after every test.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

let memoryServer;

export const mochaHooks = {
  async beforeAll() {
    // The first run may download the MongoDB binary (about 190 MB) unless `npm ci` already did; allow for it
    this.timeout(10 * 60_000);
    // A real mongod either way: in-memory by default, or your own via TEST_MONGO_URL
    let url = process.env.TEST_MONGO_URL;
    if (!url) {
      memoryServer = await MongoMemoryServer.create();
      url = memoryServer.getUri('express_api_test');
    }
    await mongoose.connect(url);
    // Build indexes before any test runs, so the unique email index exists for the duplicate tests
    await Promise.all([User.init(), Post.init()]);
  },

  async afterEach() {
    await Promise.all([User.deleteMany({}), Post.deleteMany({})]);
  },

  async afterAll() {
    await mongoose.disconnect();
    await memoryServer?.stop();
  },
};
