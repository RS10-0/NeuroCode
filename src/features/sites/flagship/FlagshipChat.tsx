import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useSiteChat, type SiteTurn } from "../render/useSiteChat";
import type { FlagshipIdentity } from "./identity";

const ResponseMarkdown = lazy(() => import("../../lab/ResponseMarkdown"));

/*
 * The conversation, once, for all five signature pages.
 *
 * The same argument `SiteChat` makes for the four generic
 * templates, and it matters more here: these five look nothing
 * like each other, and if each one owned its own transcript
 * then a fix to streaming, to the scroll rule, or to the live
 * region would be five fixes and would eventually be three.
 *
 * So the BEHAVIOUR is here and identical — `useSiteChat`
 * unchanged, which means the request shape, the visitor key,
 * the history window and the abort handling are the ones the
 * generic pages already use. What each page supplies is
 * CHROME: a header, an opening state, a mark drawn beside each
 * turn, a strip under the composer. Everything else it does
 * with CSS against `data-variant`.
 *
 * That split is the reason a manuscript margin note, a terminal
 * line and an index card can be the same component. None of
 * them is allowed to be a second implementation of the
 * transcript.
 */

export interface FlagshipPrompt {
  /* What the control says. Often not what gets sent — a chip
     reading "Structure" asks a whole question. */
  label: string;
  text: string;
  /* Optional second line, where a layout has room for one. */
  meta?: string;
}

export interface FlagshipChatProps {
  slug: string;
  identity: FlagshipIdentity;
  /* Whether the agent will actually answer. Folded together on
     the server from the owner's switch, the agent's status and
     its capabilities — see `chatLive` in publicApi. */
  live: boolean;
  /* One of five, and only a CSS hook. No behaviour branches on
     it, which is what keeps the five from drifting apart. */
  variant: "desk" | "path" | "room" | "bench" | "study";

  /* ----- SLOTS ----- */

  /* Replaces the default header strip entirely. */
  head?: ReactNode;
  /* Drawn in the log while the greeting is the only turn. */
  opening?: ReactNode;
  /* Beside each turn: a folio number, a prompt glyph, a rule. */
  mark?: (turn: SiteTurn, index: number) => ReactNode;
  /* Drawn inside the composer's frame, above the textarea — an
     active mode, a chosen subject, an open file. */
  fieldLead?: ReactNode;
  /*
   * Prepended to what the visitor typed, when the page has a
   * mode selected.
   *
   * It goes into the turn itself rather than being smuggled
   * alongside it, so the transcript shows exactly what was
   * asked. A page that quietly rewrote somebody's message
   * before sending it would be a page whose transcript is not
   * a record of the conversation.
   *
   * Not applied to a suggested prompt: those carry their own
   * complete text.
   */
  prefix?: string;
  /* Between the log and the composer. */
  beforeForm?: ReactNode;
  /* Under the composer, with the draft in hand — a word count,
     a character budget, a status line. */
  meter?: (draft: string) => ReactNode;
  /* Suggested openings. Sent on click, not typed into the box:
     a starter the visitor has to press send on twice is a
     starter most people abandon. */
  prompts?: FlagshipPrompt[];
  /*
   * A question asked from outside — a rail, a tab strip, a
   * pathway node.
   *
   * Carries an id rather than only text for the reason
   * `SiteChat` documents at length: clicking the same
   * suggestion twice has to be two questions, and an effect
   * keyed on the string would make it one.
   */
  ask?: { text: string; id: number };
}

export default function FlagshipChat({
  slug,
  identity,
  live,
  variant,
  head,
  opening,
  mark,
  fieldLead,
  prefix,
  beforeForm,
  meter,
  prompts,
  ask,
}: FlagshipChatProps) {
  const { turns, phase, send, stop } = useSiteChat(slug, identity.chat.greeting);
  const [draft, setDraft] = useState("");

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* Follow the answer down, but only from the bottom. Pulling
     the view away from somebody re-reading an earlier turn is
     the worst thing a transcript can do. */
  useEffect(() => {
    const log = logRef.current;

    if (!log) {
      return;
    }

    const distance = log.scrollHeight - log.scrollTop - log.clientHeight;

    if (distance < 140) {
      log.scrollTop = log.scrollHeight;
    }
  }, [turns]);

  /* Grow with the text, to the ceiling the stylesheet sets. */
  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }, [draft]);

  /* One send per id, however often the effect runs. See the
     note on `ask` above. */
  const askedId = useRef<number>(0);

  useEffect(() => {
    if (!ask || !live || ask.id === askedId.current) {
      return;
    }

    askedId.current = ask.id;
    void send(ask.text);
  }, [ask, live, send]);

  const busy = phase === "sending";

  const submit = () => {
    const text = draft.trim();

    if (!text || busy) {
      return;
    }

    setDraft("");
    void send(prefix ? `${prefix}\n\n${text}` : text);
  };

  const askPrompt = (text: string) => {
    if (busy || !live) {
      return;
    }

    setDraft("");
    void send(text);
  };

  if (!live) {
    return (
      <section className="fsc" data-variant={variant} data-state="offline">
        {head ?? <DefaultHead identity={identity} status="offline" />}

        <div className="fsc__offline">
          <p className="fsc__offlinetitle">Not answering right now</p>
          <p className="fsc__offlinebody">
            {identity.name} is paused. Everything else on this page still
            works.
          </p>
        </div>
      </section>
    );
  }

  /* Suggestions are an opening, not a menu. Once somebody has
     asked something of their own they are in the way — the same
     rule the generic chat follows. */
  const fresh = turns.length <= 1;
  const showPrompts = Boolean(prompts?.length) && fresh;

  return (
    <section
      className="fsc"
      data-variant={variant}
      data-state={busy ? "thinking" : "ready"}
    >
      {head ?? (
        <DefaultHead identity={identity} status={busy ? "thinking" : "ready"} />
      )}

      <div
        className="fsc__log"
        ref={logRef}
        /* New turns are announced as they land rather than
           needing to be hunted for; polite so it waits for a
           pause instead of interrupting every token. */
        aria-live="polite"
        aria-atomic="false"
      >
        {turns.map((turn, index) => {
          const streaming =
            busy &&
            turn.role === "assistant" &&
            turn === turns[turns.length - 1];

          return (
            <article
              key={turn.id}
              className="fsc__turn"
              data-role={turn.role}
              data-failed={turn.failed ? "true" : undefined}
              data-greeting={turn.id === "greeting" ? "true" : undefined}
            >
              {mark ? (
                <div className="fsc__mark" aria-hidden="true">
                  {mark(turn, index)}
                </div>
              ) : null}

              {/*
                A visitor's own words are shown exactly as typed
                and only the agent's are parsed — asterisks in
                somebody's question are asterisks, and running a
                stranger's input back through a markdown
                pipeline is surprising at best.
              */}
              <div className="fsc__body">
                {turn.role === "assistant" && !turn.failed && turn.content ? (
                  <div className="fsc__rich chatmd">
                    <Suspense
                      fallback={
                        <span style={{ whiteSpace: "pre-wrap" }}>
                          {turn.content}
                        </span>
                      }
                    >
                      {/* `streaming` closes half-written fences
                          and trims incomplete maths, so a
                          part-arrived answer renders as markdown
                          instead of flickering. */}
                      <ResponseMarkdown
                        source={turn.content}
                        streaming={streaming}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <p className="fsc__plain">{turn.content}</p>
                )}

                {streaming && !turn.content ? (
                  <span className="fsc__caret" aria-hidden="true">
                    <span className="fsc__caretdot" />
                    <span className="fsc__caretdot" />
                    <span className="fsc__caretdot" />
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}

        {fresh && opening ? <div className="fsc__opening">{opening}</div> : null}
      </div>

      {showPrompts ? (
        <div className="fsc__prompts">
          {prompts?.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              className="fsc__prompt"
              onClick={() => askPrompt(prompt.text)}
            >
              <span className="fsc__promptlabel">{prompt.label}</span>
              {prompt.meta ? (
                <span className="fsc__promptmeta">{prompt.meta}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {beforeForm}

      <form
        className="fsc__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="fsc__field">
          {fieldLead}

          <textarea
            ref={inputRef}
            className="fsc__input"
            rows={1}
            value={draft}
            placeholder={identity.chat.placeholder}
            aria-label={`Message ${identity.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              /* Enter sends, Shift+Enter breaks the line. The
                 composer is one line most of the time, so the
                 other way round would make sending the awkward
                 gesture. */
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />

          {busy ? (
            <button type="button" className="fsc__send" onClick={stop}>
              <span className="fsc__sendlabel">Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              className="fsc__send"
              disabled={!draft.trim()}
            >
              <span className="fsc__sendlabel">{identity.chat.sendLabel}</span>
            </button>
          )}
        </div>

        <div className="fsc__under">
          <p className="fsc__hint">{identity.chat.hint}</p>
          {meter ? <div className="fsc__meter">{meter(draft)}</div> : null}
        </div>
      </form>
    </section>
  );
}

/* =========================================================
   DEFAULT HEADER

   Used by any page that does not draw its own. Every one of
   the five currently does, which is the point — but a header
   is the piece most likely to be wanted plain, and a component
   that requires one to be written is a component that gets a
   copy-pasted one.
========================================================= */

function DefaultHead({
  identity,
  status,
}: {
  identity: FlagshipIdentity;
  status: "ready" | "thinking" | "offline";
}) {
  return (
    <header className="fsc__head">
      <span className="fsc__headname">{identity.name}</span>
      <span className="fsc__headstatus" data-status={status}>
        {status === "thinking"
          ? "Thinking"
          : status === "offline"
            ? "Paused"
            : "Ready"}
      </span>
    </header>
  );
}
