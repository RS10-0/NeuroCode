import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  FlaskConical,
  Globe,
  GraduationCap,
  Quote,
  Rocket,
  Sparkles,
} from "lucide-react";

import BrandMark from "../components/BrandMark";
import { useSurface } from "../components/Surface";
import { Avatar, Badge, Button, Card } from "../components/ui";
import { COURSE_CATALOG } from "../features/courses/catalog";

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

type PillarMarkKind = "learn" | "experiment" | "build" | "deploy";

const PILLARS: {
  icon: typeof GraduationCap;
  title: string;
  text: string;
  mark: PillarMarkKind;
}[] = [
  {
    icon: GraduationCap,
    title: "Learn",
    text: "Eight interactive lessons on how AI actually works — tokens, training, limits, and the reasoning behind good prompts. You do things, not read slides.",
    mark: "learn",
  },
  {
    icon: FlaskConical,
    title: "Experiment",
    text: "Change an instruction, run it again, and see exactly what moved. The Lab explains why two prompts produced different answers.",
    mark: "experiment",
  },
  {
    icon: Blocks,
    title: "Build",
    text: "Give an agent a purpose, instructions, and its own knowledge. Test it, break it, fix it. Or describe an app and build it with AI beside you.",
    mark: "build",
  },
  {
    icon: Rocket,
    title: "Deploy",
    text: "Publish what you made to a real URL. Send it to a friend and watch them use it. That last part is the point.",
    mark: "deploy",
  },
];

/* The Builder's own section names, reused here rather than
   invented — this is what the mockup on the right is actually
   showing a preview of. */
const BUILDER_NAV = ["Identity", "Model", "Knowledge", "Actions"];

/*
 * Placeholder marketing copy — no real learners quoted yet.
 * First names and descriptors only, deliberately generic.
 * Swap for real quotes before this ships.
 */
const TESTIMONIALS = [
  {
    quote:
      "I'd never written a line of code. Three weeks in, I had an agent that people I don't know were actually using.",
    name: "Priya",
    role: "self-taught, shipped a study-planner agent",
  },
  {
    quote:
      "The Lab is the first place an explanation of prompting actually stuck — I could see exactly why my version failed.",
    name: "Owen",
    role: "computer science student",
  },
  {
    quote:
      "I've built dashboards for years. This is the first course that treated 'ship it and watch someone use it' as the finish line.",
    name: "Dana",
    role: "product manager",
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

      <section className="landing__hero" id="hero">
        <div className="hero__copy">
          <span className="eyebrow">
            <Sparkles size={12} aria-hidden="true" />
            for people starting from zero
          </span>

          <h1 className="landing__headline">
            Learn AI by building something real with it.
          </h1>

          <p className="landing__sub">
            Most courses stop at explaining. BuildGentic takes you from not
            knowing what a model is, to shipping an AI agent other people can
            actually use.
          </p>

          <div className="landing__actions">
            <Link to="/register">
              <Button
                variant="primary"
                size="lg"
                iconEnd={<ArrowRight size={16} />}
              >
                Start learning
              </Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary" size="lg">
                I have an account
              </Button>
            </Link>
          </div>

          <div className="trust">
            <div className="trust__stack" aria-hidden="true">
              {TESTIMONIALS.concat(TESTIMONIALS[0]).map((person, index) => (
                <Avatar
                  key={`${person.name}-${index}`}
                  name={person.name}
                  size="sm"
                  className="trust__avatar"
                />
              ))}
            </div>
            <span className="trust__text">
              Join 1,000+ builders starting from zero
            </span>
          </div>
        </div>

        <div className="hero__visual">
          <HeroMockup />
        </div>
      </section>

      <nav className="workflow" id="workflow" aria-label="How BuildGentic works">
        <ol className="workflow__list">
          {LOOP.map((step, index) => (
            <li key={step} className="workflow__item">
              <span
                className={
                  index === 0
                    ? "workflow__node workflow__node--active"
                    : "workflow__node"
                }
              >
                <span className="workflow__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="workflow__label">{step}</span>
              </span>
              {index < LOOP.length - 1 ? (
                <span className="workflow__line" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      <section className="landing__section" id="pillars">
        <h2 className="landing__section-title">Four things you will do here</h2>
        <p className="landing__section-lede">
          Each one leads into the next. By the last lesson you are building the
          thing the course has been preparing you for.
        </p>

        <div className="pillars">
          {PILLARS.map(({ icon: Icon, title, text, mark }, index) => (
            <Card key={title} className="pillar-card">
              <span className="pillar-card__index meta">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="pillar__icon">
                <Icon size={17} aria-hidden="true" />
              </span>
              <h3 className="pillar__title">{title}</h3>
              <p className="pillar__text">{text}</p>
              <PillarMark kind={mark} />
            </Card>
          ))}
        </div>
      </section>

      <section className="landing__section" id="demo">
        <h2 className="landing__section-title">See what you will ship</h2>
        <p className="landing__section-lede">
          Not a slide deck. A real agent, live at its own address, that anyone
          with the link can open and use.
        </p>

        <DemoMockup />
      </section>

      <section className="landing__section" id="curriculum">
        <h2 className="landing__section-title">
          Five courses, in the order that makes sense
        </h2>
        <p className="landing__section-lede">
          From what a model actually is, to publishing something with your
          name on it. Open one to start — you will land back here right where
          you left off.
        </p>

        <div className="curriculum-grid">
          {COURSE_CATALOG.map((course) => (
            <Link
              key={course.courseId ?? course.title}
              to={`/courses/${course.courseId}`}
              className="curriculum-card"
            >
              <div className="curriculum-card__head">
                <Badge tone="accent" mono>
                  {course.lessonCount} lessons
                </Badge>
                <ArrowUpRight
                  size={16}
                  className="curriculum-card__arrow"
                  aria-hidden="true"
                />
              </div>
              <h3 className="curriculum-card__title">{course.title}</h3>
              <p className="curriculum-card__text">{course.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing__section" id="testimonials">
        <h2 className="landing__section-title">Builders, not just learners</h2>
        <p className="landing__section-lede">
          Early feedback from people who went through the course.
        </p>

        <div className="testimonials">
          {TESTIMONIALS.map(({ quote, name, role }) => (
            <Card key={name} className="testimonial-card">
              <Quote size={18} className="testimonial-card__mark" aria-hidden="true" />
              <p className="testimonial-card__quote">&ldquo;{quote}&rdquo;</p>
              <div className="testimonial-card__person">
                <Avatar name={name} size="sm" />
                <div>
                  <div className="testimonial-card__name">{name}</div>
                  <div className="testimonial-card__role">{role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="cta-banner">
        <h2 className="cta-banner__title">
          Stop reading about AI. Start shipping it.
        </h2>
        <p className="cta-banner__text">
          Free to start. No credit card, no prior experience — just the first
          lesson, waiting.
        </p>
        <Link to="/register">
          <Button
            variant="secondary"
            size="lg"
            iconEnd={<ArrowRight size={16} />}
            className="cta-banner__button"
          >
            Get started free
          </Button>
        </Link>
      </section>

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
            <a href="#workflow">How it works</a>
            <a href="#pillars">What you will build</a>
            <a href="#demo">Live demo</a>
            <a href="#curriculum">Curriculum</a>
          </div>

          <div className="landing-footer__col">
            <h4 className="landing-footer__heading">Account</h4>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </div>
        </div>

        <div className="landing-footer__bottom">
          © 2026 BuildGentic — learn AI by making things with it.
        </div>
      </footer>
    </div>
  );
}

/*
 * The right-hand hero visual: a static preview of the Agent
 * Builder, using its real section names rather than invented
 * ones. Purely decorative markup, so it is hidden from
 * assistive tech in favour of the headline and copy beside it.
 */
function HeroMockup() {
  return (
    <div className="mockup mockup--hero" aria-hidden="true">
      <div className="mockup__chrome">
        <span className="mockup__dot" />
        <span className="mockup__dot" />
        <span className="mockup__dot" />
        <span className="mockup__chrome-title meta">agent-builder</span>
      </div>

      <div className="mockup__body">
        <nav className="mockup__rail">
          {BUILDER_NAV.map((item, index) => (
            <span
              key={item}
              className={
                index === 1
                  ? "mockup__rail-item mockup__rail-item--active"
                  : "mockup__rail-item"
              }
            >
              {item}
            </span>
          ))}
        </nav>

        <div className="mockup__pane">
          <div className="mockup__pane-label meta">system prompt</div>
          <p className="mockup__pane-line">
            You are StudyBuddy, a patient tutor for algebra. Explain one step
            at a time.
          </p>

          <div className="mockup__pane-label meta">response</div>
          <p className="mockup__pane-line">
            Let&rsquo;s break that equation into two steps
            <span className="mockup__cursor" aria-hidden="true" />
          </p>
        </div>
      </div>
    </div>
  );
}

/*
 * The feature-demo mockup: the published version of the thing
 * the hero mockup was building. Same chrome, different content —
 * "during" versus "after".
 */
function DemoMockup() {
  return (
    <div className="mockup mockup--demo" aria-hidden="true">
      <div className="mockup__chrome">
        <span className="mockup__dot" />
        <span className="mockup__dot" />
        <span className="mockup__dot" />
        <span className="mockup__url">
          <Globe size={11} aria-hidden="true" />
          buildgentic.app/studybuddy
        </span>
      </div>

      <div className="mockup__chat">
        <div className="mockup__bubble mockup__bubble--user">
          How do I factor x² − 5x + 6?
        </div>
        <div className="mockup__bubble mockup__bubble--agent">
          Look for two numbers that multiply to 6 and add to −5 — that&rsquo;s
          −2 and −3. So it factors to (x − 2)(x − 3).
        </div>
        <div className="mockup__bubble mockup__bubble--user">
          Oh, that makes sense now
        </div>
      </div>
    </div>
  );
}

/* A small, on-palette decorative mark inside each pillar card,
   distinct per step. Inline markup rather than an image so it
   inherits the surface's tokens exactly. */
function PillarMark({ kind }: { kind: PillarMarkKind }) {
  if (kind === "learn") {
    return (
      <span className="pillar-mark pillar-mark--learn" aria-hidden="true">
        <i className="pillar-mark__dot pillar-mark__dot--fill" />
        <i className="pillar-mark__dot pillar-mark__dot--fill" />
        <i className="pillar-mark__dot" />
      </span>
    );
  }

  if (kind === "experiment") {
    return (
      <span className="pillar-mark pillar-mark--experiment" aria-hidden="true">
        <i className="pillar-mark__line pillar-mark__line--old" />
        <i className="pillar-mark__line pillar-mark__line--new" />
      </span>
    );
  }

  if (kind === "build") {
    return (
      <span className="pillar-mark pillar-mark--build" aria-hidden="true">
        <BrandMark size={16} />
      </span>
    );
  }

  return (
    <span className="pillar-mark pillar-mark--deploy" aria-hidden="true">
      <i className="pillar-mark__dot pillar-mark__dot--live" />
      <span className="pillar-mark__url">/studybuddy</span>
    </span>
  );
}
