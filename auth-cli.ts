// import "dotenv/config";
// import { betterAuth } from "better-auth";
// import { drizzleAdapter } from "better-auth/adapters/drizzle";
// import { db } from "./worker/db";
// import * as schema from "./worker/db/schema";

// export const auth = betterAuth({
//   database: drizzleAdapter(db, { provider: "sqlite", schema }),
//   secret: process.env.BETTER_AUTH_SECRET,
//   baseURL: process.env.BETTER_AUTH_URL,
//   emailAndPassword: {
//     enabled: true,
//   },
//   socialProviders: {
//     google: {
//       clientId: process.env.GOOGLE_CLIENT_ID as string,
//       clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
//       prompt: "select_account consent",
//       accessType: "offline",
//       disableImplicitSignUp: false,
//       disableSignUp: false,
//     },
//   },
//   // Add your frontend origin(s) if different from auth domain.
//   trustedOrigins: [process.env.BETTER_AUTH_URL],
// });