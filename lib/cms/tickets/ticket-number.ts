import { sql } from "drizzle-orm";
import type { Database } from "../db";

/**
 * Generate the next ticket number using a PostgreSQL sequence.
 * Returns formatted string like "ORA-000042".
 */
export async function generateTicketNumber(db: Database): Promise<string> {
  const result = await db.execute<{ nextval: string }>(
    sql`SELECT nextval('ticket_number_seq')`
  );
  const seq = Number(result.rows[0].nextval);
  return formatTicketNumber(seq);
}

/**
 * Format a raw sequence integer into the ORA-XXXXXX format.
 * Pure function — no DB access.
 */
export function formatTicketNumber(seq: number): string {
  return `ORA-${String(seq).padStart(6, "0")}`;
}

/**
 * Parse a ticket number string back to its numeric portion.
 * Returns null if the format is invalid.
 */
export function parseTicketNumber(ticketNumber: string): number | null {
  const match = ticketNumber.match(/^ORA-(\d{6})$/);
  if (!match) return null;
  return Number(match[1]);
}
