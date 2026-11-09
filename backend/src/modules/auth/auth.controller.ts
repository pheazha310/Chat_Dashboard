import type { Request, Response } from "express";
import { getAuth } from "@shared/middleware/auth.middleware.js";
import { parsed } from "@shared/middleware/validate.middleware.js";
import {
  changePasswordBody,
  createUserBody,
  listUsersQuery,
  loginBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  updateUserBody,
  userParams,
} from "./auth.schema.js";
import type { AuthService } from "./auth.service.js";
import type { Audience, ClientInfo } from "./auth.types.js";
import type { UserService } from "./user.service.js";

const clientOf = (req: Request): ClientInfo => ({ userAgent: req.get("user-agent"), ipAddress: req.ip });

/** Tokens must never be cached by a browser or proxy. */
const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

/** Sign-in endpoints. One instance per audience: the dashboard (`staff`) and the mobile app (`customer`). */
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly audience: Audience,
  ) {}

  register = async (req: Request, res: Response) => {
    noStore(res);
    const tokens = await this.service.register(parsed(req, "body", registerBody), clientOf(req));
    res.status(201).json({ status: "success", data: tokens });
  };

  login = async (req: Request, res: Response) => {
    noStore(res);
    const tokens = await this.service.login(this.audience, parsed(req, "body", loginBody), clientOf(req));
    res.json({ status: "success", data: tokens });
  };

  refresh = async (req: Request, res: Response) => {
    noStore(res);
    const { refreshToken } = parsed(req, "body", refreshBody);
    res.json({ status: "success", data: await this.service.refresh(this.audience, refreshToken, clientOf(req)) });
  };

  logout = async (req: Request, res: Response) => {
    await this.service.logout(parsed(req, "body", refreshBody).refreshToken);
    res.status(204).end();
  };

  logoutAll = async (req: Request, res: Response) => {
    await this.service.logoutAll(getAuth(req));
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    res.json({ status: "success", data: await this.service.me(getAuth(req)) });
  };

  changePassword = async (req: Request, res: Response) => {
    noStore(res);
    const input = parsed(req, "body", changePasswordBody);
    res.json({ status: "success", data: await this.service.changePassword(getAuth(req), input, clientOf(req)) });
  };
}

/** Account management under /api/v1/admin/users. */
export class UserController {
  constructor(private readonly service: UserService) {}

  list = async (req: Request, res: Response) => {
    const { items, meta } = await this.service.list(getAuth(req), parsed(req, "query", listUsersQuery));
    res.json({ status: "success", data: items, meta });
  };

  get = async (req: Request, res: Response) => {
    const { userId } = parsed(req, "params", userParams);
    res.json({ status: "success", data: await this.service.get(getAuth(req), userId) });
  };

  create = async (req: Request, res: Response) => {
    res
      .status(201)
      .json({ status: "success", data: await this.service.create(getAuth(req), parsed(req, "body", createUserBody)) });
  };

  update = async (req: Request, res: Response) => {
    const { userId } = parsed(req, "params", userParams);
    const data = await this.service.update(getAuth(req), userId, parsed(req, "body", updateUserBody));
    res.json({ status: "success", data });
  };

  resetPassword = async (req: Request, res: Response) => {
    const { userId } = parsed(req, "params", userParams);
    const { password } = parsed(req, "body", resetPasswordBody);
    res.json({ status: "success", data: await this.service.resetPassword(getAuth(req), userId, password) });
  };
}
