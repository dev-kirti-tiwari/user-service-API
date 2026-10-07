import { SecurityContext } from './index';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: SecurityContext;
    }
  }
}

export {};
