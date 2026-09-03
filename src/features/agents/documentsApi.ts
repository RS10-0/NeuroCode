import { authHeaders } from "../../lib/api";

/*
 * Fetching a file the agent made.
 *
 * The one thing worth explaining here is why this is not an
 * anchor tag.
 *
 * The download route is session-authenticated: it reads a
 * Supabase bearer token and matches the row's `user_id`. A
 * plain `<a href>` sends no Authorization header, so a link
 * would 401 — and making the route accept a token in the query
 * string instead would put a credential in a URL, which is the
 * thing that ends up in browser history, in a referrer header
 * and in somebody's server logs.
 *
 * So the bytes are fetched with the header, turned into a blob,
 * and handed to a temporary object URL that exists for one
 * click. Nothing about the file is reachable without the
 * session that fetched it.
 */

const BASE = "/api/agents";

export interface StoredDocumentSummary {
  id: string;
  title: string;
  filename: string;
  format: "pdf" | "xlsx" | "docx";
  bytes: number;
  pages?: number;
  rows?: number;
  sheets?: number;
  degraded?: string;
  agentId: string;
  runId: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function downloadDocument(
  id: string,
  filename: string
): Promise<void> {
  const response = await fetch(`${BASE}/documents/${id}`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    /*
     * One message for every failure, because the server sends
     * one status for every failure. A missing file, an expired
     * file and somebody else's file are all 404 there, on
     * purpose, and inventing three messages here would claim a
     * distinction the API deliberately does not make.
     */
    throw new Error(
      response.status === 404
        ? "That file is no longer available. Files are kept for a week."
        : "The file could not be downloaded."
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  /* Released on the next tick rather than immediately: revoking
     synchronously after click() races the browser's own read of
     the blob in some engines, and the failure is a download
     that silently produces an empty file. */
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function listAgentDocuments(
  agentId: string
): Promise<StoredDocumentSummary[]> {
  const response = await fetch(`${BASE}/${agentId}/documents`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not load this agent's files.");
  }

  const body = (await response.json()) as {
    documents?: StoredDocumentSummary[];
  };

  return body.documents ?? [];
}

/* =========================================================
   THE RECORD STORE
========================================================= */

export interface StoredRecord {
  id: string;
  key: string;
  value: string;
  label: string | null;
  revision: number;
  /* Set on a record the agent retired. The owner can restore it
     until the sweep takes it a week later. */
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreUsage {
  records: number;
  chars: number;
  maxRecords: number;
  maxChars: number;
}

export async function listRecords(
  agentId: string
): Promise<{ records: StoredRecord[]; usage: StoreUsage }> {
  const response = await fetch(`${BASE}/${agentId}/data`, {
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not load this agent's records.");
  }

  return (await response.json()) as {
    records: StoredRecord[];
    usage: StoreUsage;
  };
}

export async function restoreRecord(
  agentId: string,
  recordId: string
): Promise<void> {
  const response = await fetch(
    `${BASE}/${agentId}/data/${recordId}/restore`,
    { method: "POST", headers: await authHeaders() }
  );

  if (!response.ok) {
    throw new Error("Could not restore that record.");
  }
}

export async function deleteRecord(
  agentId: string,
  recordId: string
): Promise<void> {
  const response = await fetch(`${BASE}/${agentId}/data/${recordId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not delete that record.");
  }
}

export async function clearRecords(agentId: string): Promise<number> {
  const response = await fetch(`${BASE}/${agentId}/data`, {
    method: "DELETE",
    headers: await authHeaders(),
  });

  if (!response.ok) {
    throw new Error("Could not clear this agent's records.");
  }

  const body = (await response.json()) as { cleared?: number };

  return body.cleared ?? 0;
}
