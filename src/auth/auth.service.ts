import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { config } from "../config/env";

const googleClient = new OAuth2Client();

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

const assertAuthConfig = (): void => {
  if (!config.auth.googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  if (!config.auth.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
};

export const authenticateGoogleIdToken = async (idToken: string): Promise<AuthUser> => {
  assertAuthConfig();

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.auth.googleClientId,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google token has no email");
  if (!payload.email_verified) throw new Error("Google email is not verified");

  const normalizedEmail = payload.email.toLowerCase();
  const allowList = config.auth.allowedGoogleEmails;
  if (allowList.length > 0 && !allowList.includes(normalizedEmail)) {
    throw new Error("Google account is not allowed");
  }

  return {
    email: normalizedEmail,
    name: payload.name,
    picture: payload.picture,
  };
};

export const signAccessToken = (user: AuthUser): string => {
  assertAuthConfig();
  const signOptions: jwt.SignOptions = {
    subject: user.email,
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  };

  return jwt.sign(user, config.auth.jwtSecret, {
    ...signOptions,
  });
};

export const verifyAccessToken = (token: string): AuthUser => {
  if (!config.auth.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  const decoded = jwt.verify(token, config.auth.jwtSecret) as AuthUser;
  if (!decoded.email) throw new Error("Invalid token payload");
  return decoded;
};
