import jwt from "jsonwebtoken";
import { env } from "./env";

export type JwtPayload = {
  userId: string;
  role: "USER" | "ADMIN";
};

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
