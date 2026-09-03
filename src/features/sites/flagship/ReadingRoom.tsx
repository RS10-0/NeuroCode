import { useCallback, useState } from "react";

import FlagshipChat from "./FlagshipChat";
import { FlagshipFooter, BuildGenticMark } from "./chrome";
import { flagshipCan } from "./identity";
import type { FlagshipLayoutProps } from "./FlagshipSite";

/*
 * RESEARCH ASSISTANT — the reading room.
 *
 * Set as a journal paper, because the apparatus of one is
 * exactly the apparatus this agent is trying to teach: an
 * abstract that states the question, a method you can check, a
 * ledger of what counts as a source, and footnotes where the
 * caveats live instead of being buried in prose.
 *
 * The scholarly furniture therefore does real work. The source
 * ledger is the page's actual argument — that a source has a
 * tier and you are supposed to know which — and the enquiry
 * desk is styled as Q/A rather than as bubbles so a transcript
 * reads back like notes somebody took, which is what a visitor
 * will do with it.
 *
 * The running head, the rules and the tabular figures are the
 * decoration, and they stop at being decoration: nothing here
 * is drawn that a reader has to scroll past to reach the desk.
 */

interface Tier {
  key: string;
  label: string;
  body: string;
  ask: string;
}

/*
 * The ledger.
 *
 * Four tiers, weakest last, and every one of them is a thing a
 * student will genuinely be holding at some point — including
 * the last, which is where most first drafts get their facts.
 */
const LEDGER: Tier[] = [
  {
    key: "S1",
    label: "Peer-reviewed",
    body: "Journal articles, systematic reviews. Slow, checked by other researchers, and often behind a paywall you can get past through a library.",
    ask: "How do I find and actually read peer-reviewed sources on a topic when I am not at a university?",
  },
  {
    key: "S2",
    label: "Institutional",
    body: "Government statistics, official reports, museum and archive material. Reliable on facts, and never neutral about which facts they publish.",
    ask: "How do I use official statistics and government reports well, and what should I watch out for in them?",
  },
  {
    key: "S3",
    label: "Journalism",
    body: "Reporting from an outlet with editors and corrections. Good for what happened; check it against a primary source before you cite it for why.",
    ask: "How do I tell strong journalism from weak journalism when I am using it as a source?",
  },
  {
    key: "S4",
    label: "Open web",
    body: "Blogs, forums, encyclopaedias, anything with no named author. Useful for finding your way to a real source. Not a citation.",
    ask: "I found something useful on a site with no named author. How do I trace it back to a source I can actually cite?",
  },
];

const METHOD = [
  {
    title: "State the question",
    body: "Not the topic — the question. It will push you until the thing you are asking is answerable.",
  },
  {
    title: "Gather and weigh",
    body: "It looks for sources, tells you where each one came from, and says which of them would survive a marker reading it.",
  },
  {
    title: "Organise the evidence",
    body: "Findings get grouped, contradictions get named rather than smoothed over, and what is missing gets written down.",
  },
  {
    title: "Cite it properly",
    body: "In the style you are being marked in, with the fields a reader would need to find the source themselves.",
  },
];

const ENQUIRIES = [
  {
    label: "Help me narrow a topic into a research question",
    text: "I have a topic but not a question. Help me narrow it into something I can actually answer in an essay.",
  },
  {
    label: "Is this source good enough to cite?",
    text: "I found a source I want to use. Ask me what you need to know about it and tell me honestly whether it is good enough to cite.",
  },
  {
    label: "My sources disagree with each other",
    text: "Two of my sources contradict each other. How do I work out which one to trust, and how do I write about the disagreement?",
  },
];

export default function ReadingRoom({
  slug,
  identity,
  live,
}: FlagshipLayoutProps) {
  const [ask, setAsk] = useState<{ text: string; id: number } | undefined>();

  const send = useCallback((text: string) => {
    setAsk((current) => ({ text, id: (current?.id ?? 0) + 1 }));
  }, []);

  /* Read from the catalogue, never asserted here. Switching web
     search off for this agent has to switch this sentence off
     with it — the reasoning in FlagshipStore.flagshipSections. */
  const searches = flagshipCan("research-assistant", "web_search");

  return (
    <div className="fs-room">
      <header className="fs-room__runninghead">
        <div className="fs-room__headwrap">
          <span className="fs-room__headleft">
            BuildGentic · {identity.name}
          </span>
          <span className="fs-room__headright">{identity.eyebrow}</span>
          <BuildGenticMark label="" />
        </div>
      </header>

      <div className="fs-room__wrap">
        <article className="fs-room__paper">
          <header className="fs-room__titleblock">
            <h1 className="fs-room__title">{identity.headline}</h1>

            <p className="fs-room__byline">
              A BuildGentic flagship agent
              {searches ? ", with live source retrieval" : ""}
            </p>

            <ul className="fs-room__keywords" aria-label="Subjects">
              {["sources", "evidence", "citation", "bias", "method"].map(
                (word) => (
                  <li key={word}>{word}</li>
                )
              )}
            </ul>
          </header>

          <section className="fs-room__abstract" aria-labelledby="fs-abstract">
            <h2 className="fs-room__abstractlabel" id="fs-abstract">
              Abstract
            </h2>
            <p className="fs-room__abstractbody">{identity.deck}</p>
          </section>

          <div className="fs-room__body">
            <aside className="fs-room__apparatus">
              <section className="fs-room__block">
                <h2 className="fs-room__blocklabel">Method</h2>

                <ol className="fs-room__method">
                  {METHOD.map((step) => (
                    <li key={step.title}>
                      <span className="fs-room__methodtitle">{step.title}</span>
                      <span className="fs-room__methodbody">{step.body}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="fs-room__block">
                <h2 className="fs-room__blocklabel">Source ledger</h2>

                <dl className="fs-room__ledger">
                  {LEDGER.map((tier) => (
                    <div className="fs-room__tier" key={tier.key}>
                      <dt>
                        <button
                          type="button"
                          className="fs-room__tierbutton"
                          disabled={!live}
                          onClick={() => send(tier.ask)}
                        >
                          <span className="fs-room__tierkey">[{tier.key}]</span>
                          <span className="fs-room__tierlabel">
                            {tier.label}
                          </span>
                        </button>
                      </dt>
                      <dd>{tier.body}</dd>
                    </div>
                  ))}
                </dl>

                <p className="fs-room__ledgernote">
                  Press a tier to ask about working with it.
                </p>
              </section>
            </aside>

            <div className="fs-room__desk">
              <FlagshipChat
                slug={slug}
                identity={identity}
                live={live}
                variant="room"
                ask={ask}
                prompts={ENQUIRIES}
                head={
                  <header className="fs-room__deskhead">
                    <span className="fs-room__desklabel">Enquiry desk</span>
                    <span className="fs-room__deskmeta">
                      {searches ? "Live retrieval enabled" : "Offline reading"}
                    </span>
                  </header>
                }
                mark={(turn) => (
                  <span className="fs-room__turnkey">
                    {turn.role === "user" ? "Q." : "A."}
                  </span>
                )}
                opening={
                  <div className="fs-room__opening">
                    <p className="fs-room__openingtitle">
                      {identity.chat.openingTitle}
                    </p>
                    <p className="fs-room__openingbody">
                      {identity.chat.openingBody}
                    </p>
                  </div>
                }
              />
            </div>
          </div>

          <section className="fs-room__notes" aria-label="Notes">
            <h2 className="fs-room__blocklabel">Notes</h2>

            <ol className="fs-room__footnotes">
              <li>
                A citation you have not read is a citation you cannot defend.
                Open every source it gives you before it reaches your
                bibliography.
              </li>
              <li>
                It can be confidently wrong, and a wrong answer with a
                plausible reference attached is the most expensive kind. Treat
                a reference as a lead, not as proof.
              </li>
            </ol>
          </section>
        </article>
      </div>

      <div className="fs-room__wrap">
        <FlagshipFooter identity={identity} />
      </div>
    </div>
  );
}
