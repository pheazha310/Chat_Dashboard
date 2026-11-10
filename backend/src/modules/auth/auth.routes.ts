import { Router } from "express";
import { env } from "@config/env.js";
import { authenticate, getAuth } from "@shared/middleware/auth.middleware.js";
import { rateLimit } from "@shared/middleware/rate-limit.middleware.js";
import { validate } from "@shared/middleware/validate.middleware.js";
import { authClient, authService, rateLimitStore, userService } from "../../app-container.js";
import { AuthController, DevAuthController, UserController } from "./auth.controller.js";
import {
  changePasswordBody,
  createUserBody,
  devLoginBody,
  listUsersQuery,
  loginBody,
  losCustomerBody,
  losStaffBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  updateUserBody,
  userParams,
} from "./auth.schema.js";
import type { Audience } from "./auth.types.js";

/** Sign-in, registration, refresh and logout: per client IP (password change: per user), per minute (AUTH_RATE_LIMIT_PER_MINUTE). */
const limited = (name: string) =>
  rateLimit({ store: rateLimitStore, name, limit: env.AUTH_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });

function authRouter(audience: Audience) {
  const controller = new AuthController(authService, audience);
  const signedIn = authenticate(authClient, audience === "customer" ? ["CUSTOMER"] : undefined);
  const router = Router();
  router.post("/login", limited(`${audience}-login`), validate({ body: loginBody }), controller.login);
  router.post(
    "/los",
    limited(`${audience}-los`),
    validate({ body: audience === "customer" ? losCustomerBody : losStaffBody }),
    controller.losSignIn,
  );
  router.post("/refresh", limited(`${audience}-refresh`), validate({ body: refreshBody }), controller.refresh);
  router.post("/logout", limited(`${audience}-logout`), validate({ body: refreshBody }), controller.logout);
  router.post("/logout-all", signedIn, controller.logoutAll);
  router.get("/me", signedIn, controller.me);
  router.post(
    "/me/password",
    signedIn,
    rateLimit({
      store: rateLimitStore,
      name: `${audience}-change-password`,
      limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
      windowMs: 60_000,
      key: (req) => getAuth(req).userId,
    }),
    validate({ body: changePasswordBody }),
    controller.changePassword,
  );
  if (audience === "customer") {
    router.post("/register", limited("customer-register"), validate({ body: registerBody }), controller.register);
  }
  return router;
}

/** Mounted at /api/v1/admin/auth (no authentication at the mount: login and refresh are public). Staff accounts only. */
export const staffAuthRoutes = authRouter("staff");

/** Mounted at /api/v1/customer/auth, before the customer API's authentication. Customer accounts only. */
export const customerAuthRoutes = authRouter("customer");

/**
 * Mounted at /api/v1/dev only when AUTH_MODE=dev (app.ts): `POST /login { role, number? }` signs in as a test account
 * of that role without a password. Never mounted in production (env.ts refuses AUTH_MODE=dev there).
 */
export const devAuthRoutes = Router();
devAuthRoutes.post("/login", validate({ body: devLoginBody }), new DevAuthController(authService).login);

const users = new UserController(userService);

/** Mounted at /api/v1/admin/users (authentication is applied at the mount; the service checks the role). */
export const userRoutes = Router();

userRoutes.get("/", validate({ query: listUsersQuery }), users.list);
userRoutes.post("/", validate({ body: createUserBody }), users.create);
userRoutes.get("/:userId", validate({ params: userParams }), users.get);
userRoutes.patch("/:userId", validate({ params: userParams, body: updateUserBody }), users.update);
userRoutes.post("/:userId/password", validate({ params: userParams, body: resetPasswordBody }), users.resetPassword);
