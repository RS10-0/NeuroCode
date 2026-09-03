import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { getOnboarding } from "../lib/onboarding";

type Status = "checking" | "complete" | "incomplete";

/*
 * Sends newly created accounts through onboarding, exactly once.
 *
 * The onboarding row is the whole mechanism, and which of its
 * three states applies matters:
 *
 *   no row          an account that predates onboarding, or one
 *                   whose pending-marker write failed. Let it
 *                   through. Onboarding is for new sign-ups, and
 *                   a returning learner must never be made to
 *                   retake an assessment they already sat.
 *   completed false created through sign-up, hasn't finished.
 *                   This is the only case that redirects.
 *   completed true  done. Never again.
 *
 * This used to treat a missing row as "not onboarded", which
 * meant every existing account was pushed into the literacy
 * check the first time it loaded after the table shipped.
 *
 * All of it reads from the database, so clearing browser
 * storage, signing in elsewhere, logging out and back in, or
 * refreshing mid-session all resolve to the same answer.
 *
 * If the lookup itself fails, the learner is let through rather
 * than locked out of the whole app by a transient error.
 */
export default function RequireOnboarding() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let active = true;

    getOnboarding()
      .then((record) => {
        if (!active) {
          return;
        }

        if (!record) {
          setStatus("complete");
          return;
        }

        setStatus(record.completed ? "complete" : "incomplete");
      })
      .catch(() => {
        if (active) {
          setStatus("complete");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-muted)",
          fontSize: "var(--text-sm)",
        }}
      >
        Loading…
      </div>
    );
  }

  if (status === "incomplete") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
