import { Response, NextFunction } from "express";
import { AuthedRequest } from "./auth";

export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({ message: "Admin only" });
  }
  return next();
}
