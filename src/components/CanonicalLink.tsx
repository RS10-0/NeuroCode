import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/*
 * Keeps <link rel="canonical"> naming the page actually showing.
 *
 * Every route is served the same index.html, so the canonical
 * written there can only be right for one of them. Left alone it
 * tells a crawler that /privacy, /terms and every published
 * agent page are duplicates of the landing page. Google renders
 * the SPA before reading the head, so correcting it here is what
 * it sees.
 *
 * The origin is fixed rather than read from location: a preview
 * deployment or localhost must never claim to be the original.
 * www because the apex only ever redirects — docs/deployment.md.
 * Query strings and fragments are dropped; none of them select
 * different content.
 */

const CANONICAL_ORIGIN = "https://www.buildgentic.com";

export default function CanonicalLink() {
  const { pathname } = useLocation();

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]'
    );

    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }

    link.href = CANONICAL_ORIGIN + pathname;
  }, [pathname]);

  return null;
}
