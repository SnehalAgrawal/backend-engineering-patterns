import { Router } from 'express';
import mongoose from 'mongoose';
import { HttpError } from '../errors.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { pick } from './pick.js';

const router = Router();
const UPDATE = { returnDocument: 'after', runValidators: true };
// createdAt alone ties for records made in the same millisecond; _id (increasing) breaks the tie
const NEWEST_FIRST = { createdAt: -1, _id: -1 };
const AUTHOR = ['userId', 'name email'];

/**
 * @openapi
 * /api/posts:
 *   post:
 *     tags: [Posts]
 *     summary: Create a post for an existing user
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/PostInput' } } }
 *     responses:
 *       201: { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/Post' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *   get:
 *     tags: [Posts]
 *     summary: List posts with their author, optionally for one user
 *     parameters: [{ in: query, name: userId, schema: { type: string } }]
 *     responses:
 *       200: { description: Posts, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Post' } } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/', async (req, res) => {
  const input = pick(req.body, ['title', 'body', 'userId']);
  if (
    input.userId &&
    mongoose.isValidObjectId(input.userId) &&
    !(await User.exists({ _id: input.userId }))
  ) {
    throw new HttpError(400, 'unknown_user', `User ${input.userId} does not exist`);
  }
  res.status(201).json(await Post.create(input));
});

router.get('/', async (req, res) => {
  const filter = req.query.userId ? { userId: req.query.userId } : {};
  res.json(
    await Post.find(filter)
      .sort(NEWEST_FIRST)
      .populate(...AUTHOR),
  );
});

/**
 * @openapi
 * /api/posts/{id}:
 *   parameters: [{ $ref: '#/components/parameters/Id' }]
 *   get:
 *     tags: [Posts]
 *     summary: Get a post with its author
 *     responses:
 *       200: { description: The post, content: { application/json: { schema: { $ref: '#/components/schemas/Post' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     tags: [Posts]
 *     summary: Update a post's title or body (the author cannot change)
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, properties: { title: { type: string }, body: { type: string } } } } }
 *     responses:
 *       200: { description: The updated post, content: { application/json: { schema: { $ref: '#/components/schemas/Post' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Posts]
 *     summary: Delete a post
 *     responses:
 *       200: { description: Deleted }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', async (req, res) => {
  const post = await Post.findById(req.params.id).populate(...AUTHOR);
  if (!post) throw new HttpError(404, 'not_found', `Post ${req.params.id} not found`);
  res.json(post);
});

router.put('/:id', async (req, res) => {
  const post = await Post.findByIdAndUpdate(
    req.params.id,
    pick(req.body, ['title', 'body']),
    UPDATE,
  );
  if (!post) throw new HttpError(404, 'not_found', `Post ${req.params.id} not found`);
  res.json(post);
});

router.delete('/:id', async (req, res) => {
  const post = await Post.findByIdAndDelete(req.params.id);
  if (!post) throw new HttpError(404, 'not_found', `Post ${req.params.id} not found`);
  res.json({ deleted: true });
});

export default router;
