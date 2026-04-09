import { createAuthClient } from "better-auth/react"

const baseURL = import.meta.env.VITE_AUTH_BASE_URL || window.location.origin

export const authClient = createAuthClient({
  baseURL,
})
