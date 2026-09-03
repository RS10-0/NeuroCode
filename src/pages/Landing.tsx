import { Link } from "react-router-dom";
import { ArrowRight, Blocks, FlaskConical, GraduationCap, Rocket } from "lucide-react";

import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Button, Card } from "../components/ui";

/* The product loop, stated plainly rather than described. */
const LOOP = [
  "learn",
  "experiment",
  "build",
  "test",
  "iterate",
  "deploy",
  "share",
];

const PILLARS = [
  {
    icon: GraduationCap,
    title: "Learn",
    text: "Eight interactive lessons on how AI actually works — tokens, training, limits, and the reasoning behind good prompts. You do things, not read slides.",
  },
  {
    icon: FlaskConical,
    title: "Experiment",
    text: "Change an instruction, run it again, and see exactly what moved. The Lab explains why two prompts produced different answers.",
  },
  {
    icon: Blocks,
    title: "Build",
    text: "Give an agent a purpose, instructions, and its own knowledge. Test it, break it, fix it. Or describe an app and build it with AI beside you.",
  },
  {
    icon: Rocket,
    title: "Deploy",
    text: "Publish what you made to a real URL. Send it to a friend and watch them use it. That last part is the point.",
  },
];

export default function Landing() {
  useSurface("learn");

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

      <section className="landing__hero">
        <span className="landing__eyebrow meta">for people starting from zero</span>

        <h1 className="landing__headline">
          Learn AI by building something real with it.
        </h1>

        <p className="landing__sub">
          Most courses stop at explaining. BuildGentic takes you from not knowing
          what a model is, to shipping an AI agent other people can actually use.
        </p>

        <div className="landing__actions">
          <Link to="/register">
            <Button variant="primary" size="lg" iconEnd={<ArrowRight size={16} />}>
              Start learning
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="secondary" size="lg">
              I have an account
            </Button>
          </Link>
        </div>

        <div className="loop">
          {LOOP.map((step, index) => (
            <span key={step} className="row gap-2">
              <span
                className={
                  index === 0 ? "loop__step loop__step--strong" : "loop__step"
                }
              >
                {step}
              </span>
              {index < LOOP.length - 1 ? (
                <span className="loop__arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__section-title">Four things you will do here</h2>
        <p className="landing__section-lede">
          Each one leads into the next. By the last lesson you are building the
          thing the course has been preparing you for.
        </p>

        <div className="pillars">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <Card key={title}>
              <span className="pillar__icon">
                <Icon size={17} aria-hidden="true" />
              </span>
              <h3 className="pillar__title">{title}</h3>
              <p className="pillar__text">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="landing__foot">
        BuildGentic — learn AI by making things with it.
      </footer>
    </div>
  );
}
