import { Request, Response } from 'express';
import { userService } from '../services/user.service';
import { sendSuccess } from '../utils/response';
import {
  validateCreate,
  validateId,
  validateIdempotencyKey,
  validateListQuery,
  validateStatus,
  validateUpdate,
} from '../validators/user.validator';

/** Controllers only translate HTTP <-> service calls. Scope always comes from req.ctx, never the body. */
export const userController = {
  async create(req: Request, res: Response) {
    const input = validateCreate(req.body);
    const key = validateIdempotencyKey(req.header('idempotency-key'));
    const { user, replayed } = await userService.create(req.ctx, input, key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    sendSuccess(res, 201, 'User created successfully', user);
  },

  async list(req: Request, res: Response) {
    const query = validateListQuery(req.query);
    const { users, meta } = await userService.list(req.ctx, query);
    sendSuccess(res, 200, 'Users fetched successfully', users, meta);
  },

  async me(req: Request, res: Response) {
    sendSuccess(res, 200, 'Current user fetched successfully', await userService.getMe(req.ctx));
  },

  async getById(req: Request, res: Response) {
    const id = validateId(req.params.id);
    sendSuccess(res, 200, 'User fetched successfully', await userService.getById(req.ctx, id));
  },

  async update(req: Request, res: Response) {
    const id = validateId(req.params.id);
    const patch = validateUpdate(req.body);
    sendSuccess(res, 200, 'User updated successfully', await userService.update(req.ctx, id, patch));
  },

  async changeStatus(req: Request, res: Response) {
    const id = validateId(req.params.id);
    const status = validateStatus(req.body);
    sendSuccess(res, 200, 'User status updated successfully', await userService.changeStatus(req.ctx, id, status));
  },

  async remove(req: Request, res: Response) {
    const id = validateId(req.params.id);
    await userService.remove(req.ctx, id);
    sendSuccess(res, 200, 'User deleted successfully', { id });
  },
};
