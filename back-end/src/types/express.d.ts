export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string | null;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthenticatedUser;
    }
  }
}

export {};
