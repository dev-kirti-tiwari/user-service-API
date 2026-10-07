import { Router } from 'express';
import { userController } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { writeRateLimit } from '../middleware/rate-limit.middleware';
import { securityContext } from '../middleware/security-context.middleware';
import { asyncHandler } from '../utils/async-handler';

export const userRoutes = Router();

// Authentication -> trusted security context for every /api/v1/users route.
userRoutes.use(authenticate, securityContext);

userRoutes.post('/', writeRateLimit, asyncHandler(userController.create));
userRoutes.get('/', asyncHandler(userController.list));
// /me MUST be declared before /:id.
userRoutes.get('/me', asyncHandler(userController.me));
userRoutes.get('/:id', asyncHandler(userController.getById));
userRoutes.patch('/:id/status', writeRateLimit, asyncHandler(userController.changeStatus));
userRoutes.patch('/:id', asyncHandler(userController.update));
userRoutes.delete('/:id', writeRateLimit, asyncHandler(userController.remove));
