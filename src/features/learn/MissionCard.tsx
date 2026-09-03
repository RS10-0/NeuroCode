import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import type { LessonMission } from "../../core/curriculum/Lesson";
import { Button, Skeleton } from "../../components/ui";
import { resolveMission } from "./mission";
import type { ResolvedMission } from "./mission";

/*
 * The handoff at the end of a course.
 *
 * Course knowledge is supposed to cash out into something the
 * learner does inside the product, and this is where that
 * happens: one button, on the last completion screen, pointing
 * at the feature the course was building toward.
 *
 * Rendered in two places off the same authored data — here on
 * the completion step, and again on the course page once every
 * lesson is done, for the learner who closed the tab and came
 * back later.
 */

interface MissionCardProps {
  mission: LessonMission;

  /* The completion screen centres its content; the course page does not. */
  align?: "left" | "center";
}

export default function MissionCard({
  mission,
  align = "left",
}: MissionCardProps) {
  const [resolved, setResolved] = useState<ResolvedMission | null>(null);

  useEffect(() => {
    let active = true;

    /*
     * Resolution can hit the network — the publishing mission
     * has to look up which agent to point at. It cannot fail in
     * a way that needs handling here: resolveMission answers
     * with the fallback route rather than throwing.
     */
    resolveMission(mission).then((next) => {
      if (active) {
        setResolved(next);
      }
    });

    return () => {
      active = false;
    };
  }, [mission]);

  return (
    <div
      style={{
        maxWidth: "var(--measure)",
        margin: align === "center" ? "var(--space-7) auto 0" : "0",
        textAlign: "left",
        background: "var(--surface-2)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-5)",
      }}
    >
      <div className="meta" style={{ marginBottom: "var(--space-3)" }}>
        {mission.headline}
      </div>

      <p
        className="prose"
        style={{ margin: "0 0 var(--space-5)", color: "var(--ink-secondary)" }}
      >
        {mission.description}
      </p>

      {resolved ? (
        <>
          {resolved.note ? (
            <p
              className="prose"
              style={{
                margin: "0 0 var(--space-4)",
                fontSize: "var(--text-sm)",
                color: "var(--ink-tertiary)",
              }}
            >
              {resolved.note}
            </p>
          ) : null}

          <Link to={resolved.href}>
            <Button variant="primary" iconEnd={<ArrowRight size={16} />}>
              {resolved.label}
            </Button>
          </Link>
        </>
      ) : (
        <Skeleton width="180px" height="40px" />
      )}
    </div>
  );
}
