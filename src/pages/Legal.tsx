import { Suspense, lazy, useEffect } from "react";
import { Link } from "react-router-dom";

import BrandMark from "../components/BrandMark";
import SiteFooter from "../components/SiteFooter";
import { useSurface } from "../components/Surface";
import { Button } from "../components/ui";
import {
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type LegalDocument,
} from "../content/legal";

/*
 * The privacy policy and the terms of service.
 *
 * Two routes, one file, because they are the same page with
 * different words in it — the same header, the same measure,
 * the same footer, and a cross-link to each other that only
 * stays correct if both are edited together.
 *
 * Public and ungated on purpose, and that is not a detail. A
 * privacy policy behind a sign-in wall cannot be read by the
 * people it is written for: a parent deciding whether their
 * child may use this, a school's IT reviewer, or Google's OAuth
 * reviewer, none of whom have an account here. So these sit
 * beside "/" and "/login" in App.tsx rather than under a gate.
 */

/*
 * Split out of the main bundle, for the same reason the Lab's
 * renderer is.
 *
 * A markdown parser is around 45 kB gzipped, and importing one
 * from here would put it in the entry chunk — App.tsx imports
 * this file eagerly, so every visitor to the landing page would
 * pay for it in order that a handful of them can read a privacy
 * policy. Measured, rather than assumed: the static import cost
 * the entry chunk 155 kB raw / 46 kB gzipped.
 *
 * LegalMarkdown itself is deliberately not the Lab's
 * ResponseMarkdown. That one also pulls in KaTeX and a syntax
 * highlighter to render text a model produced; a policy has
 * neither equations nor code, and is not untrusted.
 */
const LegalMarkdown = lazy(() => import("../features/legal/LegalMarkdown"));

function LegalPage({ doc, other }: { doc: LegalDocument; other: LegalDocument }) {
  useSurface("learn");

  /*
   * Same pattern as PublicSite: no server-side rendering here,
   * so this does nothing for a link preview — but a reader who
   * has both documents open in two tabs should be able to tell
   * them apart.
   */
  useEffect(() => {
    const previous = document.title;

    document.title = `${doc.title} — BuildGentic`;

    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  /*
   * Arriving from the footer of a page the reader had scrolled
   * halfway down otherwise lands them halfway down this one.
   * React Router does not reset scroll on navigation, and there
   * is no ScrollRestoration in this app to do it for them.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [doc.path]);

  return (
    <div className="landing">
      <header className="landing__nav">
        <Link to="/" className="landing__brand">
          <span className="auth__brand-mark">
            <BrandMark size={14} />
          </span>
          <span className="auth__brand-word">BuildGentic</span>
        </Link>

        <nav className="row gap-2" aria-label="Account">
          <Link to="/login">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link to="/register">
            <Button variant="primary">Get started</Button>
          </Link>
        </nav>
      </header>

      <main className="legal">
        <header className="legal__head">
          <h1 className="legal__title">{doc.title}</h1>
          <p className="legal__updated meta">Last updated {doc.updated}</p>
          <p className="legal__lede">{doc.lede}</p>
        </header>

        {/* The title and the lede above are plain JSX and are
            painted immediately, so the fallback below replaces
            the body of the document rather than the page. */}
        <article className="md legal__body">
          <Suspense
            fallback={<p className="legal__loading">Loading the full text…</p>}
          >
            <LegalMarkdown source={doc.body} />
          </Suspense>
        </article>

        <p className="legal__crosslink">
          See also our <Link to={other.path}>{other.title}</Link>.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}

export function Privacy() {
  return <LegalPage doc={PRIVACY_POLICY} other={TERMS_OF_SERVICE} />;
}

export function Terms() {
  return <LegalPage doc={TERMS_OF_SERVICE} other={PRIVACY_POLICY} />;
}
