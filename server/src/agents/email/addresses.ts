/*
 * Whether a string could be an email address.
 *
 * A LEAF MODULE, and it is one for the reason data/keys.ts is:
 * the tools have to validate their arguments BEFORE reaching a
 * store, and every store in this project imports the Supabase
 * client — which refuses to load without SUPABASE_URL. Keeping
 * the validator here is what lets the tool catalogue, every
 * tool description and the whole offline verification suite
 * load on a machine with no database variables set.
 *
 * DELIBERATELY NOT AN RFC 5322 VALIDATOR.
 *
 * The full grammar admits quoted local parts containing spaces,
 * commas and @ signs; a regex that implements it is famously
 * unreadable and still wrong at the edges. What this has to do
 * is narrower and it is worth being precise about, because the
 * two jobs are not the same:
 *
 *   Refuse anything that plainly is not an address, so a model
 *   that assembled one out of somebody's name gets a step it
 *   can correct rather than a bounce three minutes later.
 *
 *   AND REFUSE ANY CHARACTER THAT WOULD END A MIME HEADER.
 *   That one is not cosmetic. A message is headers, a blank
 *   line, then a body — so a carriage return inside a
 *   recipient does not make a strange recipient, it makes an
 *   extra header. `\nBcc: somebody@example.com` in an address
 *   the model wrote is a silent second recipient, and this is
 *   where that is stopped rather than in the MIME builder,
 *   which is one layer too late to explain it to anybody.
 *
 * What it cannot check is whether the address EXISTS. The
 * provider answers that, and a bounce is the honest place for
 * it.
 */

const ADDRESS = /^[^\s@<>,;:"'\\\r\n]+@[^\s@<>,;:"'\\\r\n]+\.[a-z]{2,}$/i;

/*
 * The check itself, taking a string and returning a boolean.
 *
 * Separate from the exported predicate below because a type
 * guard NARROWS, and `cleanAddresses` needs the failing branch
 * to still be a string it can quote back. A predicate would
 * make that branch `never` — correct as far as the compiler is
 * concerned, and useless for saying which address was rejected.
 */
function looksLikeAddress(value: string): boolean {
  return (
    value.length >= 5 && value.length <= 320 && ADDRESS.test(value)
  );
}

export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && looksLikeAddress(value.trim());
}

export interface AddressCheck {
  ok: boolean;
  clean: string[];
  /* What was refused, so the caller can name it. Truncated,
     because it is going into a prompt and it came from a
     model. */
  rejected: string[];
}

/*
 * A list of addresses from whatever the model sent.
 *
 * Accepts an array or a comma-separated string, because models
 * produce both for the same field and a failed step spent
 * teaching one which is a step not spent answering.
 *
 * Lowercased on the way out so that a reply's recipient can be
 * compared against the sender of the message being answered
 * without the comparison depending on how somebody typed it.
 */
export function cleanAddresses(raw: unknown): AddressCheck {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];

  const clean: string[] = [];
  const rejected: string[] = [];

  for (const entry of list.slice(0, 50)) {
    const value = typeof entry === "string" ? entry.trim() : "";

    if (looksLikeAddress(value)) {
      const lowered = value.toLowerCase();

      if (!clean.includes(lowered)) {
        clean.push(lowered);
      }
    } else if (value) {
      rejected.push(value.slice(0, 80));
    }
  }

  return { ok: rejected.length === 0, clean, rejected };
}
