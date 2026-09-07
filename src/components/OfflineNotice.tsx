import { Callout } from "./ui";

/*
 * "There is no model behind this."
 *
 * The offline mock is a good thing to have: it means a fresh
 * clone runs with an empty .env, and every route, the streaming
 * transport and the usage table can be exercised without a key.
 * What was wrong was that it said so in the boot log and
 * nowhere else.
 *
 * A deployment with no provider key configured answers every
 * question with one of four fixed paragraphs, and from the
 * browser that is indistinguishable from a model that answered
 * badly — the reply is fluent, confident, and about something
 * else entirely. Somebody asked an Email Agent to find a
 * message and got advice about writing prompts, and there was
 * no way to tell from the screen that nothing had been asked of
 * a model at all.
 *
 * So: wherever an answer can be produced, this says what is
 * producing it. It is deliberately blunt about the one thing a
 * person needs to conclude — that nothing below reflects what
 * their agent would really do — rather than about the
 * configuration, which is not theirs to fix.
 */

export interface OfflineNoticeProps {
  /*
   * Straight from AiRuntimeInfo.offline, and drawn only on an
   * explicit `true`.
   *
   * `undefined` means the runtime description has not loaded
   * yet, or came from a server too old to publish the field.
   * Neither is a reason to accuse a working server of being
   * offline, so both stay silent.
   */
  offline: boolean | undefined;
  /* What this particular screen would otherwise be showing. */
  surface: "lab" | "agent";
  className?: string;
}

export default function OfflineNotice({
  offline,
  surface,
  className,
}: OfflineNoticeProps) {
  if (offline !== true) {
    return null;
  }

  return (
    <Callout
      tone="caution"
      title="No AI model is connected — these answers are not real"
      {...(className ? { className } : {})}
    >
      This server has no model provider configured, so every reply comes from a
      built-in stand-in that returns one of four fixed paragraphs. It does not
      read your instructions, look anything up, or use any of the tools you have
      turned on
      {surface === "agent"
        ? " — so nothing here shows what your agent would actually do."
        : " — so nothing here shows how a real model would answer."}{" "}
      Whoever runs this BuildGentic needs to set a model provider key on the
      server; there is nothing to fix from this screen.
    </Callout>
  );
}
