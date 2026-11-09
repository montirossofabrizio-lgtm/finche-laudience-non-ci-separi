import crypto from "node:crypto";
import { getSql } from "./db";

const HUMAN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function makeGameCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => HUMAN_ALPHABET[b % HUMAN_ALPHABET.length]).join("");
}

export function makeRecoveryKey() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => HUMAN_ALPHABET[b % HUMAN_ALPHABET.length]).join("");
}

export async function requireSession(request) {
  const code = (request.headers.get("x-game-code") || "").trim().toUpperCase();
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!code || !token) return null;

  const sql = getSql();
  const tokenHash = hashToken(token);
  const rows = await sql`
    SELECT
      g.id AS game_id,
      g.code,
      g.updated_at,
      p.id AS player_id,
      p.role,
      p.current_scene
    FROM players p
    JOIN games g ON g.id = p.game_id
    WHERE g.code = ${code} AND p.token_hash = ${tokenHash}
    LIMIT 1
  `;
  return rows[0] || null;
}
