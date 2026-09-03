import { neurolinkCurriculum } from "../curriculum/registry";
import { LearningEngine } from "./LearningEngine";

/*
 * One engine over every course.
 *
 * The registry hands over all five courses as a single
 * curriculum. Every lookup the engine performs already filters
 * by lesson.courseId, so nothing here has to know how many
 * courses exist — adding one means adding it to the registry
 * and nothing else.
 */
export const learningEngine = new LearningEngine(neurolinkCurriculum);

export { LearningEngine };
