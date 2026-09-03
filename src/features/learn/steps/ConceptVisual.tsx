import { ArrowRight } from "lucide-react";

import type { ConceptVisual as ConceptVisualType } from "../../../core/curriculum/Lesson";

/*
 * Renders the diagram attached to a concept step.
 *
 * The curriculum has always been able to carry one of these and
 * never did, so all 23 concept screens were the same shape:
 * heading, paragraph, three example cards. A picture is the
 * cheapest way to make two concepts look like different ideas
 * rather than different text.
 *
 * Everything here is CSS and markup — no charting dependency,
 * no SVG viewBox to keep in sync. Colours come from the theme
 * tokens, so light and dark both work without a second palette.
 */

interface ConceptVisualProps {
  visual: ConceptVisualType;
}

export default function ConceptVisual({ visual }: ConceptVisualProps) {
  if (visual.type === "none") {
    return null;
  }

  return (
    <figure className="cvis">
      {renderBody(visual)}
    </figure>
  );
}

function renderBody(visual: ConceptVisualType) {
  switch (visual.type) {
    /* ----------------------------------------------------- */

    case "comparison": {
      const { left, right } = visual.data;

      return (
        <div className="cvis__compare">
          {[left, right].map((side, index) => (
            <div
              key={side.label}
              className={
                index === 0
                  ? "cvis__compare-side"
                  : "cvis__compare-side cvis__compare-side--alt"
              }
            >
              <div className="cvis__compare-label">{side.label}</div>

              <ul className="cvis__compare-points">
                {side.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    }

    /* ----------------------------------------------------- */

    case "flow": {
      return (
        <ol className="cvis__flow">
          {visual.data.stages.map((stage, index) => (
            <li key={stage.id} className="cvis__flow-item">
              <div className="cvis__flow-stage">
                <span className="cvis__flow-index">{index + 1}</span>
                <span className="cvis__flow-label">{stage.label}</span>

                {stage.caption ? (
                  <span className="cvis__flow-caption">{stage.caption}</span>
                ) : null}
              </div>

              {index < visual.data.stages.length - 1 ? (
                <ArrowRight
                  className="cvis__flow-arrow"
                  size={16}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
      );
    }

    /* ----------------------------------------------------- */

    case "diagram": {
      const { nodes, links = [] } = visual.data;

      /* Edge labels are looked up by the pair they join. */
      const labelFor = (fromId: string, toId: string) =>
        links.find((link) => link.from === fromId && link.to === toId)?.label;

      return (
        <div className="cvis__diagram">
          {nodes.map((node, index) => {
            const next = nodes[index + 1];
            const edge = next ? labelFor(node.id, next.id) : undefined;

            return (
              <div key={node.id} className="cvis__diagram-run">
                <div className="cvis__node">
                  <span className="cvis__node-label">{node.label}</span>

                  {node.caption ? (
                    <span className="cvis__node-caption">{node.caption}</span>
                  ) : null}
                </div>

                {next ? (
                  <div className="cvis__edge" aria-hidden="true">
                    <span className="cvis__edge-line" />
                    {edge ? (
                      <span className="cvis__edge-label">{edge}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      );
    }

    /* ----------------------------------------------------- */

    case "timeline": {
      return (
        <ol className="cvis__timeline">
          {visual.data.milestones.map((milestone) => (
            <li key={milestone.id} className="cvis__milestone">
              <span className="cvis__milestone-dot" aria-hidden="true" />

              <div className="cvis__milestone-body">
                <div className="cvis__milestone-when">{milestone.when}</div>
                <div className="cvis__milestone-label">{milestone.label}</div>

                {milestone.caption ? (
                  <p className="cvis__milestone-caption">{milestone.caption}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      );
    }

    /* ----------------------------------------------------- */

    case "before_after": {
      const { before, after, transform } = visual.data;

      return (
        <div className="cvis__ba">
          <div className="cvis__ba-state">
            <div className="cvis__ba-label">{before.label}</div>
            <p className="cvis__ba-body">{before.body}</p>
          </div>

          <div className="cvis__ba-transform">
            <ArrowRight size={16} aria-hidden="true" />
            {transform ? <span>{transform}</span> : null}
          </div>

          <div className="cvis__ba-state cvis__ba-state--after">
            <div className="cvis__ba-label">{after.label}</div>
            <p className="cvis__ba-body">{after.body}</p>
          </div>
        </div>
      );
    }

    /* ----------------------------------------------------- */

    case "data": {
      const { bars, caption } = visual.data;

      return (
        <div className="cvis__data">
          {bars.map((bar) => {
            const value = Math.max(0, Math.min(100, bar.value));

            return (
              <div key={bar.id} className="cvis__bar-row">
                <div className="cvis__bar-head">
                  <span className="cvis__bar-label">{bar.label}</span>
                  <span className="cvis__bar-value">{value}%</span>
                </div>

                <div
                  className="cvis__bar-track"
                  role="img"
                  aria-label={`${bar.label}: ${value} percent`}
                >
                  <span
                    className="cvis__bar-fill"
                    style={{ width: `${value}%` }}
                  />
                </div>

                {bar.note ? (
                  <div className="cvis__bar-note">{bar.note}</div>
                ) : null}
              </div>
            );
          })}

          {caption ? (
            <figcaption className="cvis__caption">{caption}</figcaption>
          ) : null}
        </div>
      );
    }

    /* ----------------------------------------------------- */

    default:
      return null;
  }
}
