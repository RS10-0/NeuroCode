import type { AvatarTone } from "./types";

/*
 * An agent's face.
 *
 * Deliberately not the UI kit's Avatar: that one renders a
 * person's initials, and an agent is not a person. Initials
 * derived from a name would make a shelf of agents look like a
 * team directory, which is precisely the wrong idea to give a
 * learner about what they have just built.
 *
 * A glyph the learner chose is also the only part of an agent
 * that is theirs at a glance — everything else on a card is a
 * model id or a badge.
 */

interface AgentFaceProps {
  emoji: string;
  tone: AvatarTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function AgentFace({
  emoji,
  tone,
  size = "md",
  className,
}: AgentFaceProps) {
  return (
    <span
      className={`face face--${size} face--${tone}${
        className ? ` ${className}` : ""
      }`}
      /* The glyph carries no information a screen reader needs —
         the agent's name is always beside it — and read aloud it
         would announce "robot face" before the name. */
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
