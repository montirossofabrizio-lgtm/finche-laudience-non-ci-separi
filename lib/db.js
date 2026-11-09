import { neon } from "@neondatabase/serverless";

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL non configurato. Collega Neon a Vercel oppure usa la demo locale.");
  }
  return neon(process.env.DATABASE_URL);
}
