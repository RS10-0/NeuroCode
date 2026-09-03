import { Check, Save } from "lucide-react";

import { Button } from "../../components/ui";

/*
 * Whether the work on screen is safe, and the one control that
 * makes it so.
 *
 * Sticky rather than parked at the bottom of the form, because
 * the Builder is four sections and a conversation and a learner
 * spends most of their time somewhere in the middle of it. A
 * Save button you have to go looking for is a Save button people
 * forget to press.
 *
 * The state indicator says one of three things and never
 * bluffs: unsaved, saving, or saved with nothing outstanding.
 */

interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  /* False when the configuration could not be saved as it
     stands — a missing name, a model this source cannot reach. */
  valid: boolean;
  /* Null until the first save. Changes the button's wording,
     because "Save" and "Create" answer different questions. */
  agentId: string | null;
  invalidHint?: string;
  onSave: () => void;
}

export default function SaveBar({
  dirty,
  saving,
  valid,
  agentId,
  invalidHint,
  onSave,
}: SaveBarProps) {
  const state = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : agentId
        ? "All changes saved"
        : "Not saved yet";

  const dotClass = saving
    ? "savebar__dot"
    : dirty || !agentId
      ? "savebar__dot savebar__dot--dirty"
      : "savebar__dot savebar__dot--saved";

  return (
    <div className="savebar">
      <p className="savebar__state">
        <span className={dotClass} aria-hidden="true" />
        {/*
          A polite live region: the state changes as a result of
          something the learner did, and they should hear that
          the save landed without being interrupted mid-word.
        */}
        <span role="status">{state}</span>
      </p>

      <div className="savebar__actions">
        {!valid && invalidHint ? (
          <span className="savebar__state">{invalidHint}</span>
        ) : null}

        <Button
          variant="primary"
          icon={agentId && !dirty ? <Check size={15} /> : <Save size={15} />}
          disabled={saving || !valid || (!dirty && Boolean(agentId))}
          onClick={onSave}
        >
          {saving ? "Saving…" : agentId ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </div>
  );
}
