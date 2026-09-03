import { ArrowRight, GitCompare } from "lucide-react";

import { abbreviate, diffSettings, type LabRun } from "./types";

/*
 * What moved between this run and the one before it.
 *
 * The page's promise is "change one thing, run it again, and
 * see what moved", and this is the half that keeps it. A list
 * of past answers would be a transcript; the useful artefact is
 * the pairing — this run, and the single setting that differed
 * from the last one.
 *
 * Two runs with identical settings get their own message rather
 * than an empty panel, because "nothing changed and the answer
 * still differs" is one of the most useful things a learner can
 * observe here: it is sampling, and it is the whole of what
 * temperature does.
 */

interface WhatChangedProps {
  /* Newest first, as the history is stored. */
  runs: LabRun[];
}

export default function WhatChanged({ runs }: WhatChangedProps) {
  const [current, previous] = runs;

  const changes =
    current && previous
      ? diffSettings(previous.settings, current.settings)
      : [];

  return (
    <section className="changed" aria-labelledby="changed-heading">
      <h2 className="rail-heading" id="changed-heading">
        <GitCompare size={14} aria-hidden="true" />
        What Changed?
      </h2>

      {!current ? (
        <p className="changed__idle">
          Run an experiment twice and this shows exactly which setting you
          altered between them.
        </p>
      ) : !previous ? (
        <p className="changed__idle">
          That was your first run this session. Change one thing, run it
          again, and the difference appears here.
        </p>
      ) : changes.length === 0 ? (
        <p className="changed__same">
          <strong>Nothing changed.</strong> Identical settings to the run
          before — so any difference in the answer came from the model&apos;s
          own sampling, not from anything you did.
        </p>
      ) : (
        <ul className="changed__list">
          {changes.map((change) => (
            <li key={change.field} className="changed__row">
              <span className="changed__field">{change.label}</span>

              <span className="changed__values">
                <span className="changed__from">
                  {abbreviate(change.from, 30)}
                </span>

                <ArrowRight
                  size={13}
                  aria-hidden="true"
                  className="changed__arrow"
                />

                {/* The arrow is decorative, so the relationship
                    has to be said out loud somewhere. */}
                <span className="sr-only">changed to</span>

                <span className="changed__to">
                  {abbreviate(change.to, 30)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
