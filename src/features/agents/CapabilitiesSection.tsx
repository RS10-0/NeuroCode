import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  REQUIRED_CAPABILITY,
  type CapabilityId,
} from "./capabilities";

/*
 * What the agent is allowed to do.
 *
 * This screen was written when four of thirteen worked, and it
 * showed: one flat column of every switch in the order they
 * were built, each with its full explanation printed
 * underneath, closed by a callout apologising for how few there
 * were. All thirteen work now, which turned the apology into a
 * lie and the column into a wall of small italic text nobody
 * reaches the bottom of.
 *
 * Three things fix that, and each is a rule rather than a
 * decoration:
 *
 * Grouped by the question being asked — what can it find out,
 * what can it do, what does it keep — because "web search" and
 * "send email" are not the same kind of decision and should
 * not be adjacent.
 *
 * A real switch on every card. The old card only announced its
 * state through a background tint, which is a state you can
 * miss and one that says nothing about what clicking would do.
 *
 * And the long hint behind a disclosure. Those paragraphs are
 * the most useful writing on the screen and they earned their
 * length — the email ones say where the edges are before an
 * account is connected — but printed thirteen at once they
 * became texture. Open on request, and open by default once a
 * capability is on, which is when the detail starts mattering.
 */

interface CapabilitiesSectionProps {
  capabilities: CapabilityId[];
  onChange: (next: CapabilityId[]) => void;
}

export default function CapabilitiesSection({
  capabilities,
  onChange,
}: CapabilitiesSectionProps) {
  const hintBase = useId();

  /* Which explanations are open. Keyed by capability, so
     opening one does not close another — comparing Memory
     against Keep Records is the reason two would be open. */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  function toggle(id: CapabilityId) {
    if (id === REQUIRED_CAPABILITY) {
      return;
    }

    onChange(
      capabilities.includes(id)
        ? capabilities.filter((entry) => entry !== id)
        : [...capabilities, id]
    );
  }

  const onCount = CAPABILITIES.filter((entry) =>
    capabilities.includes(entry.id)
  ).length;

  /* Counted against what can actually be switched on, not
     against the length of the list — "2 of 13" reads as eleven
     things left to try when four of them cannot be tried. */
  const readyCount = CAPABILITIES.filter((entry) => entry.ready).length;
  const soonCount = CAPABILITIES.length - readyCount;

  return (
    <section className="agentsec" aria-labelledby="agentsec-capabilities">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-capabilities">
          Capabilities
        </h2>

        <p className="agentsec__lede">
          What your agent is allowed to do beyond answering from what you have
          told it. Switching one on does not make your agent use it — it makes
          it able to, and it decides question by question. The Test panel shows
          you which it reached for and what it got back.
        </p>

        <p className="caps__count">
          <span className="caps__countnum">{onCount}</span> of {readyCount} on
          {soonCount > 0 ? ` · ${soonCount} coming soon` : null}
        </p>
      </div>

      <div className="agentsec__body">
        {CAPABILITY_GROUPS.map((group) => {
          const entries = CAPABILITIES.filter(
            (capability) => capability.group === group.id
          );

          if (entries.length === 0) {
            return null;
          }

          return (
            <div className="capgroup" key={group.id}>
              <div className="capgroup__head">
                <h3 className="capgroup__title">{group.label}</h3>
                <p className="capgroup__blurb">{group.blurb}</p>
              </div>

              <ul className="caps">
                {entries.map((capability) => {
                  const Icon = capability.icon;
                  const on = capabilities.includes(capability.id);
                  const locked = capability.id === REQUIRED_CAPABILITY;

                  /*
                   * All thirteen are ready today, and this
                   * branch still exists on purpose: the rule
                   * this file enforces is that a switch which
                   * flips and changes nothing must not be
                   * offered. The next capability to be written
                   * lands here before its runtime does.
                   */
                  const soon = !capability.ready;

                  const hint = capability.soonHint ?? capability.onHint;
                  const hintId = `${hintBase}-${capability.id}`;

                  /* On means the detail is worth reading, so it
                     starts open there — until the learner says
                     otherwise, which the state map remembers. */
                  const showHint = open[capability.id] ?? on;

                  let cardClass = "cap";
                  if (soon) {
                    cardClass = "cap cap--soon";
                  } else if (on) {
                    cardClass = "cap cap--on";
                  }

                  return (
                    <li className={cardClass} key={capability.id}>
                      <button
                        type="button"
                        className="cap__toggle"
                        /*
                         * A switch, not a pressed button: this
                         * turns something on and leaves it on,
                         * and a screen reader should say so.
                         *
                         * aria-disabled rather than disabled, so
                         * an unbuilt one stays reachable by
                         * keyboard — reading what is coming is
                         * the entire reason it is on the page.
                         */
                        role="switch"
                        aria-checked={soon ? false : on}
                        aria-disabled={locked || soon || undefined}
                        onClick={() => {
                          if (!soon) {
                            toggle(capability.id);
                          }
                        }}
                      >
                        <span className="cap__mark" aria-hidden="true">
                          <Icon size={16} />
                        </span>

                        <span className="cap__body">
                          <span className="cap__title">
                            {capability.label}

                            {soon ? (
                              <span className="cap__tag">Soon</span>
                            ) : null}

                            {locked ? (
                              <span className="cap__tag">Always on</span>
                            ) : null}
                          </span>

                          <span className="cap__blurb">{capability.blurb}</span>
                        </span>

                        <span className="cap__switch" aria-hidden="true">
                          <span className="cap__knob" />
                        </span>
                      </button>

                      {hint ? (
                        <>
                          <button
                            type="button"
                            className="cap__more"
                            aria-expanded={showHint}
                            aria-controls={hintId}
                            onClick={() =>
                              setOpen((current) => ({
                                ...current,
                                [capability.id]: !showHint,
                              }))
                            }
                          >
                            <ChevronDown
                              size={13}
                              aria-hidden="true"
                              className="cap__chevron"
                            />
                            {showHint
                              ? "Hide detail"
                              : soon
                                ? "What this will do"
                                : "What this changes"}
                          </button>

                          <p
                            className="cap__hint"
                            id={hintId}
                            hidden={!showHint}
                          >
                            {hint}
                          </p>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
