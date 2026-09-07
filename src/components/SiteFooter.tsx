import { Link, useLocation } from "react-router-dom";

import BrandMark from "./BrandMark";

/*
 * The public site's footer.
 *
 * It lived inline in Landing.tsx until there was a second
 * public page to put it on. The legal pages are that second
 * page, and they are also the reason it has a Legal column: a
 * privacy policy nobody can find from the site is a document,
 * not a disclosure.
 *
 * Not used inside the authenticated shell. A signed-in learner
 * navigates by the rail, and a marketing footer under the
 * dashboard would be furniture.
 */

/*
 * The Product column points at sections of the landing page,
 * which only exist on the landing page.
 *
 * A bare "#workflow" from /privacy is a link to nothing — it
 * resolves against the current document and the browser finds
 * no such element, so the click silently does nothing. "/#workflow"
 * is correct from anywhere, but on the landing page itself it
 * costs a full document load to scroll a few hundred pixels.
 *
 * So: the in-page form where it works, the absolute form
 * everywhere else.
 */
const SECTIONS: { hash: string; label: string }[] = [
  { hash: "workflow", label: "How it works" },
  { hash: "pillars", label: "What you will build" },
  { hash: "demo", label: "Live demo" },
  { hash: "curriculum", label: "Curriculum" },
];

export default function SiteFooter() {
  const { pathname } = useLocation();
  const onLanding = pathname === "/";

  return (
    <footer className="landing-footer">
      <div className="landing-footer__grid">
        <div className="landing-footer__brand">
          <Link to="/" className="landing__brand">
            <span className="auth__brand-mark">
              <BrandMark size={14} />
            </span>
            <span className="auth__brand-word">BuildGentic</span>
          </Link>
          <p className="landing-footer__tagline">
            Learn AI by building something real with it.
          </p>
        </div>

        <div className="landing-footer__col">
          <h4 className="landing-footer__heading">Product</h4>
          {SECTIONS.map(({ hash, label }) => (
            <a key={hash} href={onLanding ? `#${hash}` : `/#${hash}`}>
              {label}
            </a>
          ))}
        </div>

        <div className="landing-footer__col">
          <h4 className="landing-footer__heading">Account</h4>
          <Link to="/login">Sign in</Link>
          <Link to="/register">Create account</Link>
        </div>

        <div className="landing-footer__col">
          <h4 className="landing-footer__heading">Legal</h4>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </div>

      <div className="landing-footer__bottom">
        © 2026 BuildGentic — learn AI by making things with it.
      </div>
    </footer>
  );
}
