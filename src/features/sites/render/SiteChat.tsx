import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { SiteAvatar } from "./parts";

/*
 * The same renderer the Lab and the Builder use, not a second
 * one written for public pages.
 *
 * It costs a large chunk — KaTeX and a syntax highlighter — so
 * it is loaded lazily and therefore only by visitors who
 * actually start a conversation. A page somebody opens to read
 * pays nothing for it, which matters more here than anywhere
 * else in BuildGentic: this is the one screen loaded by people
 * who did not choose to use the product.
 *
 * It needs no restyling to sit here. Every rule under `.md`
 * reads semantic tokens — --ink, --accent, --surface-inset —
 * and `.site` redefines exactly those per palette, so a
 * rendered answer takes on the student's colours by
 * construction rather than by a second stylesheet agreeing
 * with the first.
 */
const ResponseMarkdown = lazy(() => import("../../lab/ResponseMarkdown"));
import { useSiteChat } from "./useSiteChat";
import type { PublicAgentFace } from "../publicApi";
import type { SiteChat as SiteChatConfig } from "../schema";

/*
 * The chat, once, for all four templates.
 *
 * Every template puts this somewhere different — centred, in a
 * pane, in a dock, under an abstract — and none of them
 * restyles what is inside it. The frame is CSS; the behaviour
 * is here. So a fix to the transcript is a fix on every
 * template, which is the only reason four layouts is a
 * reasonable amount of code to maintain.
 */

export interface SiteChatProps {
  slug: string;
  agent: PublicAgentFace;
  config: SiteChatConfig;
  /* Whether the agent will actually answer. Distinct from the
     student's own on/off switch — see `chatLive` in publicApi. */
  live: boolean;
  /* Prompts are listed in the study template's rail instead of
     inside the chat, so it suppresses them here. */
  hidePrompts?: boolean;
  /*
   * A question asked from outside this component — the study
   * template's rail lists the suggested prompts beside the chat
   * rather than inside it, and a click there has to arrive as a
   * real turn.
   *
   * An id rather than a bare string, and the id is the whole
   * point. Sending on a changed string would mean a visitor who
   * clicks the same suggestion twice gets nothing the second
   * time — the value did not change, so nothing fires. Sending
   * on every render would ask the same question repeatedly at
   * the owner's expense. A token the parent increments per
   * click is the only version of this that is right in both
   * directions.
   */
  ask?: { text: string; id: number };
}

export default function SiteChat({
  slug,
  agent,
  config,
  live,
  hidePrompts,
  ask,
}: SiteChatProps) {
  const { turns, phase, send, stop } = useSiteChat(slug, config.greeting);
  const [draft, setDraft] = useState("");

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /*
   * Follow the answer down, but only when the visitor is
   * already at the bottom. Yanking the view back while somebody
   * is reading an earlier turn is the single most irritating
   * thing a chat transcript can do.
   */
  useEffect(() => {
    const log = logRef.current;

    if (!log) {
      return;
    }

    const distance = log.scrollHeight - log.scrollTop - log.clientHeight;

    if (distance < 120) {
      log.scrollTop = log.scrollHeight;
    }
  }, [turns]);

  /* Grow with the text, up to the ceiling the stylesheet sets. */
  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [draft]);

  /*
   * A question from outside, sent exactly once.
   *
   * The ref is what makes "once" true. `send` is a new function
   * on every render — it closes over `phase` — so an effect
   * depending on it would fire again the moment the answer
   * started arriving, and ask the same question a second time.
   * Recording the value that has been handled means the effect
   * can run as often as React likes and still send one turn.
   */
  const askedId = useRef<number>(0);

  useEffect(() => {
    if (!ask || !live || ask.id === askedId.current) {
      return;
    }

    askedId.current = ask.id;
    void send(ask.text);
  }, [ask, live, send]);

  if (!live) {
    return (
      <div className="sitechat">
        <ChatHead agent={agent} status="offline" />
        <div className="sitechat__offline">
          This agent is not answering at the moment. Everything else on
          the page still works.
        </div>
      </div>
    );
  }

  const busy = phase === "sending";

  const submit = () => {
    const text = draft.trim();

    if (!text || busy) {
      return;
    }

    setDraft("");
    void send(text);
  };

  const askPrompt = (prompt: string) => {
    if (busy) {
      return;
    }

    setDraft("");
    void send(prompt);
  };

  /* Suggestions are an opener, not a permanent menu: once the
     visitor has asked something of their own they are in the
     way. */
  const showPrompts =
    !hidePrompts && config.suggestedPrompts.length > 0 && turns.length <= 1;

  return (
    <div className="sitechat">
      <ChatHead agent={agent} status={busy ? "thinking" : "ready"} />

      <div
        className="sitechat__log"
        ref={logRef}
        /* The transcript announces new turns as they land rather
           than requiring a screen reader user to go looking for
           them; `polite` so it waits for a pause instead of
           interrupting every token. */
        aria-live="polite"
        aria-atomic="false"
      >
        {turns.map((turn) => {
          const streaming =
            busy && turn.role === "assistant" && turn === turns[turns.length - 1];

          return (
            <div
              key={turn.id}
              className={[
                "sitechat__turn",
                `sitechat__turn--${turn.role}`,
                turn.failed ? "sitechat__turn--error" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {turn.role === "assistant" && !turn.failed ? (
                <SiteAvatar agent={agent} size="sm" />
              ) : null}

              {/*
                A visitor's own words are shown exactly as typed;
                only the agent's are parsed. Asterisks in
                somebody's question are asterisks, and running a
                stranger's input through a markdown pipeline to
                render it back at them would be surprising at
                best.
              */}
              <div
                className={
                  turn.role === "assistant" && !turn.failed
                    ? "sitechat__bubble sitechat__bubble--rich"
                    : "sitechat__bubble"
                }
              >
                {turn.role === "assistant" && !turn.failed && turn.content ? (
                  <Suspense
                    fallback={
                      <span style={{ whiteSpace: "pre-wrap" }}>
                        {turn.content}
                      </span>
                    }
                  >
                    {/* `streaming` closes half-written code
                        fences and trims incomplete maths, so a
                        part-arrived answer renders as markdown
                        rather than flickering between raw and
                        formatted. See markdown.ts. */}
                    <ResponseMarkdown
                      source={turn.content}
                      streaming={streaming}
                    />
                  </Suspense>
                ) : (
                  turn.content
                )}

                {streaming && !turn.content ? (
                  <span className="sitechat__caret" aria-hidden="true" />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {showPrompts ? (
        <div className="sitechat__prompts">
          {config.suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="sitechat__prompt"
              onClick={() => askPrompt(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="sitechat__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          className="sitechat__input"
          rows={1}
          value={draft}
          placeholder={config.placeholder || "Ask a question…"}
          aria-label={`Message ${agent.name}`}
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
          <button
            type="button"
            className="sitechat__send"
            onClick={stop}
            aria-label="Stop"
          >
            <Square size={15} strokeWidth={2} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="sitechat__send"
            disabled={!draft.trim()}
            aria-label="Send"
          >
            <ArrowUp size={18} strokeWidth={2.2} />
          </button>
        )}
      </form>
    </div>
  );
}

function ChatHead({
  agent,
  status,
}: {
  agent: PublicAgentFace;
  status: "ready" | "thinking" | "offline";
}) {
  const label =
    status === "thinking"
      ? "Thinking…"
      : status === "offline"
        ? "Offline"
        : "Online";

  return (
    <header className="sitechat__head">
      <SiteAvatar agent={agent} size="sm" />
      <span className="sitechat__name">{agent.name}</span>
      <span className="sitechat__status">{label}</span>
    </header>
  );
}
