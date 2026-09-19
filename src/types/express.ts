// Adds the fields requireAuth() attaches to every authenticated request.
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}

export {};
