import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: string;
  };
  file?: Express.Multer.File;
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const payload = verifyAccessToken(token);

    const authReq = req as AuthRequest;
    authReq.user = {
      userId: payload.userId,
      role: payload.role,
    };

    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}
