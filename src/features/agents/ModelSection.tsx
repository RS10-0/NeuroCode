import { Callout, Field, Input } from "../../components/ui";
import type {
  AiLimits,
  AiModel,
  AiUsageReport,
} from "../../lib/aiClient";
import { UsageMeters } from "../lab/UsageMeters";
import { describeTemperature } from "../lab/explain";
import type { AgentErrors } from "./validate";
import type { AgentDraft } from "./types";

/*
/*
 * How the agent answers.
 *
 * This section used to open with a model picker and a
 * power-source switcher, and it has neither now. BuildGentic
 * routes every request across its own providers, choosing per
 * request, so there is no model to pick and no account to pick
 * between — offering either would be offering a choice the
 * router is free to overrule a second later.
 *
 * What is left is the two settings that genuinely change what
 * comes back, and the meters, which are still the Lab's own
 * component for the reason the switcher used to be: a learner
 * should meet the same allowance, said the same way, in both
 * places.
 */

interface ModelSectionProps {
  usage: AiUsageReport | null;
  draft: AgentDraft;
  models: AiModel[];
  model: AiModel | undefined;
  limits: AiLimits | undefined;
  errors: AgentErrors;
  /* Locked mid-stream. */
  disabled: boolean;
  onChange: (next: Partial<AgentDraft>) => void;
}

export default function ModelSection({
  usage,
  draft,
  models,
  model,
  limits,
  errors,
  disabled,
  onChange,
}: ModelSectionProps) {
  const temperature = describeTemperature(draft.temperature);

  /* The real ceiling: already clamped by the learner's
     allowance before it was published. */
  const outputCeiling = model?.maxOutputTokens ?? limits?.maxOutputTokens ?? 0;

  return (
    <section className="agentsec" aria-labelledby="agentsec-model">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-model">
          Answering
        </h2>

        <p className="agentsec__lede">
          How your agent replies. These are the same controls the AI Lab
          offers, because your agent runs on the same runtime — it is a saved
          configuration, not a separate service.
        </p>
      </div>

      <div className="agentsec__body">
        <UsageMeters usage={usage} />

        {models.length === 0 ? (
          <Callout tone="caution" title="AI is unavailable">
            This BuildGentic server has no usable AI configured.
          </Callout>
        ) : null}

        {model ? (
          <p className="agentsec__note">
            {model.blurb} Context window {model.contextWindow.toLocaleString()}{" "}
            tokens; at most {model.maxOutputTokens.toLocaleString()} tokens per
            reply.
          </p>
        ) : null}

        <Field
          label="Temperature"
          hint={`${temperature.name} — ${temperature.detail}`}
          error={errors.temperature}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={disabled}
              onChange={(event) =>
                onChange({ temperature: Number(event.target.value) })
              }
            />
          )}
        </Field>

        <Field
          label="Longest reply"
          hint={
            outputCeiling > 0
              ? `In tokens — roughly four characters each. At most ${outputCeiling.toLocaleString()} here.`
              : "In tokens — roughly four characters each."
          }
          error={errors.maxOutputTokens}
        >
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={outputCeiling > 0 ? outputCeiling : undefined}
              step={64}
              value={draft.maxOutputTokens}
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={disabled}
              onChange={(event) =>
                onChange({ maxOutputTokens: Number(event.target.value) })
              }
            />
          )}
        </Field>

        <p className="agentsec__note">
          A cap, not a target. The agent stops when it has finished or when it
          hits this, whichever comes first — an answer that ends mid-sentence
          has hit it.
        </p>
      </div>
    </section>
  );
}
