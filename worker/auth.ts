import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import {
  initializeUserProblemTables,
  refreshUserLeetcodeTable,
} from "./user-problems-do";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
      prompt: "select_account consent",
      accessType: "offline",
      disableImplicitSignUp: false,
      disableSignUp: false,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID as string,
      clientSecret: env.GITHUB_CLIENT_SECRET as string,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
      allowDifferentEmails: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        async after(user) {
          await initializeUserProblemTables(user.email);
        },
      },
    },
    session: {
      create: {
        async after(session, ctx) {
          if (!ctx) return;
          const user = await ctx.context.internalAdapter.findUserById(session.userId);
          if (!user?.email) return;
          await refreshUserLeetcodeTable(user.email);
        },
      },
    },
  },
  trustedOrigins: [env.BETTER_AUTH_URL],
});
