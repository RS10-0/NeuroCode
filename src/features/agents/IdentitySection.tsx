import { Field, Input, Textarea } from "../../components/ui";
import AgentFace from "./AgentFace";
import type { AgentErrors } from "./validate";
import {
  AVATAR_GLYPHS,
  AVATAR_TONES,
  type AgentDraft,
  type AvatarTone,
} from "./types";

/*
 * Who the agent is, and what it has been told.
 *
 * The name and the glyph are the small half. The system
 * instructions are the section's real content and the single
 * most consequential field in the whole Builder: everything a
 * learner has already worked out in the Lab about how a system
 * prompt changes an answer applies here unchanged, and this is
 * where that knowledge becomes permanent rather than lasting one
 * run.
 *
 * So the instructions get the full-width box, the character
 * counter, and the explanation — not the name.
 */

interface IdentitySectionProps {
  draft: AgentDraft;
  errors: AgentErrors;
  /* The server's own maxSystemChars, so the counter measures
     against the real budget rather than a copy of it. */
  systemBudget: number;
  onChange: (next: Partial<AgentDraft>) => void;
}

export default function IdentitySection({
  draft,
  errors,
  systemBudget,
  onChange,
}: IdentitySectionProps) {
  const used = draft.instructions.length;
  const ratio = systemBudget > 0 ? used / systemBudget : 0;

  const countClass =
    ratio >= 1
      ? "knowledge__budget-count knowledge__budget-count--over"
      : ratio >= 0.85
        ? "knowledge__budget-count knowledge__budget-count--near"
        : "knowledge__budget-count";

  return (
    <section className="agentsec" aria-labelledby="agentsec-identity">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-identity">
          Identity
        </h2>

        <p className="agentsec__lede">
          What your agent is called, and what it has been told to do. The
          instructions travel with every single message — they are the
          difference between a model and an agent.
        </p>
      </div>

      <div className="agentsec__body">
        <div className="agentid">
          <div className="agentid__preview">
            <AgentFace
              emoji={draft.avatarEmoji}
              tone={draft.avatarTone}
              size="lg"
            />
            <p className="meta">Preview</p>
          </div>

          <div className="agentid__pickers">
            <fieldset className="stack gap-2">
              <legend className="field__label">Symbol</legend>

              <div className="glyphs" role="radiogroup" aria-label="Symbol">
                {AVATAR_GLYPHS.map((glyph) => (
                  <button
                    key={glyph}
                    type="button"
                    role="radio"
                    aria-checked={draft.avatarEmoji === glyph}
                    /* The glyph is decorative in the face, but
                       here it IS the choice, so it has to be
                       nameable. */
                    aria-label={`Symbol ${glyph}`}
                    className={
                      draft.avatarEmoji === glyph
                        ? "glyphs__item glyphs__item--on"
                        : "glyphs__item"
                    }
                    onClick={() => onChange({ avatarEmoji: glyph })}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="stack gap-2">
              <legend className="field__label">Colour</legend>

              <div className="tones" role="radiogroup" aria-label="Colour">
                {AVATAR_TONES.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.avatarTone === tone.id}
                    className={
                      draft.avatarTone === tone.id
                        ? "tones__item tones__item--on"
                        : "tones__item"
                    }
                    onClick={() =>
                      onChange({ avatarTone: tone.id as AvatarTone })
                    }
                  >
                    <span
                      className="tones__swatch"
                      style={{ background: `var(--${tone.id})` }}
                      aria-hidden="true"
                    />
                    {tone.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>

        <Field
          label="Name"
          hint="What you will see it called on your shelf."
          error={errors.name}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              value={draft.name}
              invalid={invalid}
              aria-describedby={describedBy}
              placeholder="Revision Tutor"
              maxLength={80}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Description"
          hint="One line about what it is for. Only you see this."
          error={errors.description}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              value={draft.description}
              invalid={invalid}
              aria-describedby={describedBy}
              placeholder="Explains A-level biology topics and asks follow-up questions."
              maxLength={280}
              onChange={(event) =>
                onChange({ description: event.target.value })
              }
            />
          )}
        </Field>

        <Field
          label="System instructions"
          hint="Sent ahead of every message, in its own field — never as something the person typed."
          error={errors.instructions}
        >
          {({ id, invalid, describedBy }) => (
            <Textarea
              id={id}
              rows={10}
              value={draft.instructions}
              invalid={invalid}
              aria-describedby={describedBy}
              placeholder={
                "You are a patient biology tutor for A-level students.\n\nExplain in short paragraphs. After every explanation, ask one question that checks whether it landed. If you are not sure of something, say so rather than guessing."
              }
              onChange={(event) =>
                onChange({ instructions: event.target.value })
              }
            />
          )}
        </Field>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <p className="agentsec__note">
            Say what it should do, who it is for, and how it should behave when
            it does not know something. Instructions that describe behaviour
            beat instructions that describe a personality.
          </p>

          <span className={countClass}>
            {used.toLocaleString()} / {systemBudget.toLocaleString()}
          </span>
        </div>
      </div>
    </section>
  );
}
