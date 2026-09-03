import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import type { ReactNode } from "react";

import SiteRenderer from "../features/sites/render/SiteRenderer";
import {
  fetchPublicSite,
  SiteError,
  type PublicSite as PublicSiteData,
} from "../features/sites/publicApi";
import { canonicalizeSlug, isValidSlug } from "../features/sites/slug";

/*
 * A student's page, on BuildGentic's domain, for anybody.
 *
 * The whole route exists outside every gate in App.tsx: no
 * RequireAuth, no RequireOnboarding, no AppShell, no
 * CreditsProvider. That is not a shortcut — it is the feature.
 * A page somebody shares with their class has to open for a
 * person who has never heard of BuildGentic, and any of those
 * wrappers would redirect them to a login screen.
 *
 * It is also why this page renders no BuildGentic navigation. A
 * visitor is not in the application; they are on a page that
 * happens to be hosted by it. The only BuildGentic thing on
 * screen is the footer badge, which the renderer draws.
 */

type Phase =
  | { state: "loading" }
  | { state: "ready"; site: PublicSiteData }
  | { state: "missing" }
  | { state: "error"; error: SiteError };

export default function PublicSite() {
  const params = useParams<{ slug: string }>();
  const raw = params.slug ?? "";

  /*
   * The canonical form of what is in the address bar.
   *
   * "/StudyBuddy" and "/studybuddy" are the same page, and
   * serving both would mean a page with two addresses, two sets
   * of shared links and no answer to which one is right. So the
   * uppercase form redirects to the lowercase one before
   * anything is fetched.
   */
  const slug = useMemo(() => canonicalizeSlug(raw), [raw]);

  const needsRedirect = slug !== raw && slug.length > 0;

  /*
   * A slug the rules reject cannot exist in the database, so
   * asking is a round trip whose answer is already known. This
   * also means a reserved word that somehow reached this route
   * — a static route removed from App.tsx, say — renders the
   * not-found page rather than querying for something the
   * server would refuse to have stored.
   */
  const resolvable = !needsRedirect && isValidSlug(slug);

  /*
   * The answer, tagged with the address it answers.
   *
   * Tagged rather than cleared, because clearing means writing
   * state from inside the effect on every navigation — a
   * cascading render, and the thing React's lint rule is right
   * to object to. Carrying the slug in the result makes a
   * stale answer identifiable during render instead: if it does
   * not match the address being asked about, it is simply not
   * this page's answer, and the page is still loading.
   */
  const [answer, setAnswer] = useState<{ slug: string; phase: Phase } | null>(
    null
  );

  useEffect(() => {
    if (!resolvable) {
      return;
    }

    const controller = new AbortController();

    fetchPublicSite(slug, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }

        setAnswer({
          slug,
          phase: result.found
            ? { state: "ready", site: result.site }
            : { state: "missing" },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setAnswer({
          slug,
          phase: {
            state: "error",
            error:
              error instanceof SiteError
                ? error
                : new SiteError(
                    "This page could not be loaded. Check your connection and try again.",
                    0,
                    "network"
                  ),
          },
        });
      });

    return () => controller.abort();
  }, [slug, resolvable]);

  const phase: Phase = !resolvable
    ? /* A redirect is about to happen, so there is nothing to
         say yet; anything else at this point is an address that
         could never have been a page. */
      needsRedirect
      ? { state: "loading" }
      : { state: "missing" }
    : answer?.slug === slug
      ? answer.phase
      : { state: "loading" };

  /*
   * The document title is the one piece of page chrome this
   * route owns. There is no server-side rendering in this
   * project, so a link shared into a chat app will not preview
   * — but a visitor who opens it and keeps the tab should see
   * the agent's name rather than "BuildGentic".
   */
  const title =
    phase.state === "ready"
      ? phase.site.config.siteName
      : phase.state === "missing"
        ? "Page not found"
        : null;

  useEffect(() => {
    if (!title) {
      return;
    }

    const previous = document.title;

    document.title = title;

    return () => {
      document.title = previous;
    };
  }, [title]);

  if (needsRedirect) {
    return <Navigate to={`/${slug}`} replace />;
  }

  if (phase.state === "loading") {
    return <SiteLoading />;
  }

  if (phase.state === "missing") {
    return <SiteMissing slug={slug} />;
  }

  if (phase.state === "error") {
    return <SiteUnavailable message={phase.error.message} />;
  }

  return <SiteRenderer site={phase.site} />;
}

/* =========================================================
   THE THREE STATES THAT ARE NOT A PAGE

   All three are deliberately plain and carry no BuildGentic
   navigation. Somebody who followed a broken link should be
   told the link is broken, not marketed to.
========================================================= */

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="sitefallback">
      <div className="sitefallback__inner">{children}</div>
    </div>
  );
}

function SiteLoading() {
  return (
    <Shell>
      <div className="sitefallback__pulse" aria-hidden="true" />
      <p className="sitefallback__note">Loading…</p>
    </Shell>
  );
}

function SiteMissing({ slug }: { slug: string }) {
  return (
    <Shell>
      <h1 className="sitefallback__title">No page here</h1>
      <p className="sitefallback__body">
        {slug
          ? `Nothing is published at /${slug}. The address may have changed, or the page may have been taken down.`
          : "That address does not point at a page."}
      </p>
      <a className="sitefallback__link" href="/">
        Go to BuildGentic
      </a>
    </Shell>
  );
}

function SiteUnavailable({ message }: { message: string }) {
  return (
    <Shell>
      <h1 className="sitefallback__title">Not available</h1>
      <p className="sitefallback__body">{message}</p>
      <a className="sitefallback__link" href="/">
        Go to BuildGentic
      </a>
    </Shell>
  );
}
