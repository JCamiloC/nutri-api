import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthUser, UserRole } from "../types/auth.js";

type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  labId: string | null;
};

export function signAccessToken(user: AuthUser): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    labId: user.labId,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "unauthorized", message: "Token requerido" });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      labId: decoded.labId,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "unauthorized", message: "Token inválido o expirado" });
  }
}

/** Escritura: admin de lab o superadmin. */
export function requireWrite(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (req.user.role === "lab_reader") {
    return res.status(403).json({
      error: "forbidden",
      message: "Tu rol es solo lectura",
    });
  }
  return next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "forbidden", message: "Solo superadmin" });
  }
  return next();
}
