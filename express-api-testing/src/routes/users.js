import { Router } from 'express';
import { HttpError } from '../errors.js';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { pick } from './pick.js';

const router = Router();
const FIELDS = ['name', 'email'];
const UPDATE = { returnDocument: 'after', runValidators: true };
// createdAt alone ties for records made in the same millisecond; _id (increasing) breaks the tie
const NEWEST_FIRST = { createdAt: -1, _id: -1 };

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/UserInput' } } }
 *     responses:
 *       201: { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   get:
 *     tags: [Users]
 *     summary: List users, newest first
 *     responses:
 *       200: { description: Users, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/User' } } } } }
 */
router.post('/', async (req, res) => {
  res.status(201).json(await User.create(pick(req.body, FIELDS)));
});

router.get('/', async (_req, res) => {
  res.json(await User.find().sort(NEWEST_FIRST));
});

/**
 * @openapi
 * /api/users/{id}:
 *   parameters: [{ $ref: '#/components/parameters/Id' }]
 *   get:
 *     tags: [Users]
 *     summary: Get a user
 *     responses:
 *       200: { description: The user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     tags: [Users]
 *     summary: Update a user's name or email
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/UserInput' } } }
 *     responses:
 *       200: { description: The updated user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *   delete:
 *     tags: [Users]
 *     summary: Delete a user and their posts
 *     responses:
 *       200: { description: Deleted, content: { application/json: { schema: { type: object, properties: { deletedPosts: { type: integer } } } } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
async function findUser(id) {
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'not_found', `User ${id} not found`);
  return user;
}

router.get('/:id', async (req, res) => {
  res.json(await findUser(req.params.id));
});

router.put('/:id', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, pick(req.body, FIELDS), UPDATE);
  if (!user) throw new HttpError(404, 'not_found', `User ${req.params.id} not found`);
  res.json(user);
});

router.delete('/:id', async (req, res) => {
  const user = await findUser(req.params.id);
  const { deletedCount } = await Post.deleteMany({ userId: user._id });
  await user.deleteOne();
  res.json({ deleted: true, deletedPosts: deletedCount });
});

export default router;
