import { Check } from "lucide-react";

import { Callout } from "../../components/ui";
import {
  CAPABILITIES,
  REQUIRED_CAPABILITY,
  type CapabilityId,
} from "./capabilities";

/*
 * What the agent is allowed to do.
 *
 * Four of these work, and the section says so rather than
 * arranging six toggles that all look equally real. The unbuilt
 * ones are shown anyway — dimmed, in the tab order, announced as
 * unavailable, each carrying a line about what it needs — for
 * the same reason the Lab lists its unbuilt workspaces: an agent
 * that can only hold a conversation makes far more sense as the
 * first capability of several than as the whole of what an agent
 * has ever been.
 *
 * The rule that decides the design: a switch that flips and
 * changes nothing about the answers is worse than no switch at
 * all, because a learner would spend an afternoon working out
 * why their agent ignores the web. Nothing here can be turned on
 * until the runtime can actually carry it out.
 */

interface CapabilitiesSectionProps {
  capabilities: CapabilityId[];
  onChange: (next: CapabilityId[]) => void;
}

export default function CapabilitiesSection({
  capabilities,
  onChange,
}: CapabilitiesSectionProps) {
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

  return (
    <section className="agentsec" aria-labelledby="agentsec-capabilities">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-capabilities">
          Capabilities
        </h2>

        <p className="agentsec__lede">
          What your agent can do beyond answering from what it has been told.
          The first five change what it knows — what it can look up, read and
          remember. The last two change what it can <em>do</em>: write and run
          a program, or call a real service and use the answer. Switch one on
          and the Test panel shows you exactly what it did, step by step.
        </p>
      </div>

      <div className="agentsec__body">
        <ul className="caps">
          {CAPABILITIES.map((capability) => {
            const Icon = capability.icon;
            const on = capabilities.includes(capability.id);
            const locked = capability.id === REQUIRED_CAPABILITY;

            return (
              <li key={capability.id}>
                <button
                  type="button"
                  className={
                    capability.ready
                      ? on
                        ? "cap cap--on"
                        : "cap"
                      : "cap cap--soon"
                  }
                  /*
                   * aria-disabled rather than disabled: the entry
                   * stays reachable by keyboard so a learner can
                   * read what is coming, which is the entire
                   * reason it is on the page.
                   */
                  aria-disabled={!capability.ready || locked}
                  aria-pressed={capability.ready ? on : undefined}
                  onClick={() => {
                    if (capability.ready) {
                      toggle(capability.id);
                    }
                  }}
                >
                  <span className="cap__mark" aria-hidden="true">
                    {on ? <Check size={16} /> : <Icon size={16} />}
                  </span>

                  <span className="cap__body">
                    <span className="cap__title">
                      {capability.label}

                      {capability.ready ? null : (
                        <span className="cap__soon">Soon</span>
                      )}

                      {locked ? (
                        <span className="cap__soon">Always on</span>
                      ) : null}
                    </span>

                    <span className="cap__blurb">{capability.blurb}</span>

                    {capability.soonHint ?? capability.onHint ? (
                      <span className="cap__hint">
                        {capability.soonHint ?? capability.onHint}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <Callout tone="info" title="Why so few">
          The greyed-out ones each need something the runtime does not have
          yet — a sandbox to run code in, somewhere to keep what is
          remembered. They are named here rather than hidden so that what your
          agent cannot do is as visible as what it can, and none of them is
          faked in the meantime. Web search and file analysis were both on
          that list until recently. Switching one on and asking the same
          question twice — once with it, once without — is the fastest way to
          see what it changes, and the Test panel tells you every time what
          your agent actually looked at.
        </Callout>
      </div>
    </section>
  );
}
