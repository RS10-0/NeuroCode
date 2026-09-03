import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import ScheduleFeed from "./ScheduleFeed";
import {
  Bot,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  Hammer,
  LayoutDashboard,
  LogOut,
  Sparkles,
  Zap,
} from "lucide-react";
import { useCredits } from "../features/credits/useCredits";
import { capStateOf } from "../lib/credits";
import { useAuth } from "../auth/useAuth";
import BrandMark from "./BrandMark";
import { useSurface } from "./Surface";
import { Avatar, IconButton } from "./ui";

interface NavItem {
  to: string;
  label: string;
  /* Shorter label for the mobile tab bar, where seven must fit
     across a 320px phone. Verified there rather than assumed. */
  shortLabel?: string;
  icon: typeof GraduationCap;
  /*
   * Match this path exactly rather than as a prefix.
   *
   * Needed on /agents, which is the parent of /agents/builder —
   * without it, opening the builder lights up My Agents as well
   * and the rail claims the learner is in two places at once.
   */
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

/*
 * The application's destinations, and the one place their
 * hierarchy is written down.
 *
 * Agents is a group rather than a single entry because building
 * an agent and managing the ones you have built are genuinely
 * two activities, and a learner needs to know which one they are
 * about to open before they click. The mental model the grouping
 * is there to teach:
 *
 *   Agent Builder — the workshop. Where an agent is made.
 *   My Agents     — the shelf. Where the finished ones live.
 *   Agent Library — the shop. Where BuildGentic's own agents are,
 *                   for learners who want a good one before
 *                   they can build a good one.
 *
 * Everything else stays a flat top-level destination. Grouping
 * for its own sake would push Dashboard and Courses a level down
 * for no gain; this is the only pair that needs the distinction
 * drawn.
 */
const NAV: NavEntry[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: LayoutDashboard,
  },
  { to: "/courses", label: "Courses", icon: GraduationCap },
  { to: "/lab", label: "AI Lab", shortLabel: "Lab", icon: FlaskConical },
  {
    label: "Agents",
    items: [
      {
        to: "/agents/builder",
        label: "Agent Builder",
        shortLabel: "Build",
        icon: Hammer,
      },
      {
        to: "/agents",
        label: "My Agents",
        shortLabel: "Agents",
        icon: Bot,
        /* See NavItem.end. */
        end: true,
      },
      {
        to: "/agents/library",
        label: "Agent Library",
        shortLabel: "Library",
        icon: Sparkles,
      },
    ],
  },
  { to: "/projects", label: "Projects", icon: FolderOpen },
];

/* The tab bar has no room for group headings, so it takes the
   leaves in the order the rail presents them. */
const NAV_LEAVES: NavItem[] = NAV.flatMap((entry) =>
  isGroup(entry) ? entry.items : [entry]
);

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { user, logout } = useAuth();

  useSurface();

  const displayName = user?.username || user?.email || "Learner";

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className="rail">
        <Link to="/dashboard" className="rail__brand">
          <span className="rail__mark">
            <BrandMark size={15} />
          </span>
          <span className="rail__wordmark">BuildGentic</span>
        </Link>

        <nav className="rail__nav" aria-label="Main">
          {NAV.map((entry) =>
            isGroup(entry) ? (
              <RailGroup key={entry.label} group={entry} />
            ) : (
              <RailItem key={entry.to} item={entry} />
            )
          )}
        </nav>

        <span className="rail__spacer" />

        <XpMeter />

        <div className="rail__footer">
          <Link to="/profile" className="rail__user">
            <Avatar name={displayName} size="sm" />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="rail__user-name">{displayName}</span>
            </span>
          </Link>

          <ScheduleFeed />

          <IconButton
            label="Sign out"
            icon={<LogOut size={16} />}
            size="sm"
            onClick={() => {
              void logout();
            }}
          />
        </div>
      </aside>

      <div className="shell__main">
        <main id="main">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {NAV_LEAVES.map(({ to, label, shortLabel, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            /*
              The full label stays the accessible name — a tab
              reading "Build" out loud when the page says "Agent
              Builder" is a mismatch worth avoiding.
            */
            aria-label={shortLabel ? label : undefined}
            className={({ isActive }) =>
              isActive ? "tabbar__item tabbar__item--active" : "tabbar__item"
            }
          >
            <Icon size={19} aria-hidden="true" />
            {shortLabel ?? label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/* =========================================================
   RAIL ENTRIES
========================================================= */

function RailItem({ item, nested = false }: { item: NavItem; nested?: boolean }) {
  const { to, label, icon: Icon, end } = item;

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "rail__item",
          nested ? "rail__item--nested" : "",
          isActive ? "rail__item--active" : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      <Icon className="rail__icon" size={17} aria-hidden="true" />
      {label}
    </NavLink>
  );
}

/*
 * A labelled group.
 *
 * The heading is a real <h2> inside a nested <ul>, not a styled
 * <span> above a flat list — so a screen reader announces "Agents,
 * list of 2 items" and the relationship the indent draws for a
 * sighted learner is actually in the markup.
 */
function RailGroup({ group }: { group: NavGroup }) {
  const headingId = `rail-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section className="rail__group" aria-labelledby={headingId}>
      <h2 className="rail__group-label" id={headingId}>
        {group.label}
      </h2>

      <div className="rail__group-items">
        {group.items.map((item) => (
          <RailItem key={item.to} item={item} nested />
        ))}
      </div>
    </section>
  );
}

/* =========================================================
   XP

   The learner's spendable balance, in the rail so it is on
   screen wherever they are rather than only on the page that
   spends it. Somebody who runs out mid-experiment should have
   been watching it go down.

   IT IS NOT A DAILY ALLOWANCE ANY MORE. XP accumulates: it
   carries over from day to day and stops at a ceiling, which is
   what makes saving up for an Agent Library agent possible. So
   the meter reads against that ceiling, and the label no longer
   says "today" — a learner watching this go up over a week is
   the behaviour the wallet is now designed to produce.
========================================================= */

function XpMeter() {
  const { credits } = useCredits();

  if (!credits || !credits.available) {
    return null;
  }

  const { balance, maxBalance, dailyGrant } = credits;

  /*
   * Full, or full by tomorrow. The rail says so quietly — a
   * different fill colour and a sentence in the tooltip — and
   * the Dashboard says it properly. A meter is the right place
   * to notice the state and the wrong place to explain it.
   */
  const cap = capStateOf(credits);

  /*
   * "Low" is measured against the day's grant rather than
   * against the ceiling, and the difference matters once XP
   * accumulates. Fifteen percent of a 300 ceiling is 45 — more
   * than a whole day's earnings — so a learner spending
   * normally would sit in the warning colour for most of a
   * week. What actually deserves a warning is a balance small
   * against what arrives tomorrow.
   */
  const low = Math.max(1, Math.round(dailyGrant * 0.25));

  return (
    <Link
      to="/profile"
      className="rail__xp"
      title={
        cap === "full"
          ? `Full at ${maxBalance} XP. Anything you earn now is discarded until you spend some — try the Agent Library.`
          : cap === "near"
            ? `${balance} XP saved of ${maxBalance}. Tomorrow's ${dailyGrant} will not all fit — spend a little to keep earning.`
            : `${balance} XP saved, out of a ${maxBalance} maximum. You earn ${dailyGrant} a day just for showing up, and more for finishing lessons.`
      }
    >
      <span className="rail__xp-head">
        <Zap size={13} aria-hidden="true" />
        <span className="rail__xp-label">XP</span>
        <span className="rail__xp-value">
          {balance}
          <span className="rail__xp-of">/{maxBalance}</span>
        </span>
      </span>

      <span className="rail__xp-track">
        <span
          className={[
            "rail__xp-fill",
            balance === 0 ? "rail__xp-fill--empty" : "",
            balance > 0 && balance <= low ? "rail__xp-fill--low" : "",
            cap === "full" ? "rail__xp-fill--full" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            width: `${maxBalance > 0 ? Math.min(100, (balance / maxBalance) * 100) : 0}%`,
          }}
        />
      </span>

      <span className="sr-only">
        {balance} XP saved of a {maxBalance} maximum.
        {cap === "full"
          ? " Your XP is full — spend some to keep earning."
          : ""}
      </span>
    </Link>
  );
}

