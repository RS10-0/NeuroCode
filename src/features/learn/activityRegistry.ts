import type { ComponentType } from "react";

import type {
  ActivityStep,
  InteractiveType,
} from "../../core/curriculum/Lesson";
import type { StepProps } from "./types";

export type ActivityComponent = ComponentType<StepProps<ActivityStep>>;

/*
 * Interactive activity registry.
 *
 * The curriculum authors 21 distinct InteractiveTypes. They are
 * NOT 21 unrelated components — most collapse into a handful of
 * families that differ only by configuration:
 *
 *   bucket-sort   ai_sorter, dataset_playground, dataset_imbalance,
 *                 data_redaction, policy_creator, edge_case_matrix
 *   parameter     parameter_tuning, temperature_slider, ethics_dial,
 *                 fairness_metrics
 *   case-review   fact_checker, truth_assessment, bias_audit,
 *                 model_testing
 *   composer      decision_tree_builder, prompt_weaver,
 *                 prompt_refinement
 *   bespoke       tokenizer_playground, vector_similarity,
 *                 next_token_game, capstone_pipeline
 *
 * Registering a type here is the only wiring an activity needs —
 * the player and the step host require no change.
 */
const registry = new Map<InteractiveType, ActivityComponent>();

export function registerActivity(
  type: InteractiveType,
  component: ActivityComponent
): void {
  registry.set(type, component);
}

export function getActivity(
  type: InteractiveType
): ActivityComponent | undefined {
  return registry.get(type);
}

export function registeredActivityTypes(): InteractiveType[] {
  return [...registry.keys()];
}
