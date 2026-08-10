import { promises as fs } from "fs";
import path from "path";

export type MasteryLevel =
  | "not_started"
  | "learning"
  | "developing"
  | "proficient"
  | "mastered";

export interface ConceptProgress {
  conceptId: string;
  mastery: MasteryLevel;
  attempts: number;
  successfulAttempts: number;
  lastAttemptAt?: string;
}

export interface StudentProgress {
  studentId: string;
  completedLessonIds: string[];
  conceptProgress: ConceptProgress[];
  currentLessonId?: string;
}

const DATA_DIRECTORY = path.join(
  process.cwd(),
  "data"
);

const DATA_FILE = path.join(
  DATA_DIRECTORY,
  "progress.json"
);

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIRECTORY, {
    recursive: true,
  });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(
      DATA_FILE,
      "{}",
      "utf8"
    );
  }
}

async function readAllProgress(): Promise<
  Record<string, StudentProgress>
> {
  await ensureDataFile();

  const contents = await fs.readFile(
    DATA_FILE,
    "utf8"
  );

  if (!contents.trim()) {
    return {};
  }

  try {
    return JSON.parse(contents);
  } catch {
    return {};
  }
}

async function writeAllProgress(
  progress: Record<string, StudentProgress>
): Promise<void> {
  await ensureDataFile();

  await fs.writeFile(
    DATA_FILE,
    JSON.stringify(progress, null, 2),
    "utf8"
  );
}

function createEmptyProgress(
  studentId: string
): StudentProgress {
  return {
    studentId,
    completedLessonIds: [],
    conceptProgress: [],
  };
}

export async function getProgress(
  studentId: string
): Promise<StudentProgress> {
  const allProgress =
    await readAllProgress();

  if (!allProgress[studentId]) {
    const progress =
      createEmptyProgress(studentId);

    allProgress[studentId] = progress;

    await writeAllProgress(allProgress);

    return progress;
  }

  return allProgress[studentId];
}

export async function saveProgress(
  progress: StudentProgress
): Promise<StudentProgress> {
  const allProgress =
    await readAllProgress();

  allProgress[progress.studentId] =
    progress;

  await writeAllProgress(allProgress);

  return progress;
}

export async function recordEvaluation(
  studentId: string,
  lessonId: string,
  conceptIds: string[],
  correct: boolean
): Promise<StudentProgress> {
  const progress =
    await getProgress(studentId);

  const now =
    new Date().toISOString();

  for (const conceptId of conceptIds) {
    const existing =
      progress.conceptProgress.find(
        (item) =>
          item.conceptId === conceptId
      );

    if (existing) {
      existing.attempts += 1;

      if (correct) {
        existing.successfulAttempts += 1;
      }

      existing.mastery =
        calculateMastery(
          existing.attempts,
          existing.successfulAttempts
        );

      existing.lastAttemptAt = now;
    } else {
      const attempts = 1;

      const successfulAttempts =
        correct ? 1 : 0;

      progress.conceptProgress.push({
        conceptId,
        attempts,
        successfulAttempts,
        mastery: calculateMastery(
          attempts,
          successfulAttempts
        ),
        lastAttemptAt: now,
      });
    }
  }

  if (correct) {
    if (
      !progress.completedLessonIds.includes(
        lessonId
      )
    ) {
      progress.completedLessonIds.push(
        lessonId
      );
    }
  }

  progress.currentLessonId = lessonId;

  return saveProgress(progress);
}

function calculateMastery(
  attempts: number,
  successfulAttempts: number
): MasteryLevel {
  if (attempts === 0) {
    return "not_started";
  }

  const successRate =
    successfulAttempts / attempts;

  if (
    attempts >= 5 &&
    successRate >= 0.9
  ) {
    return "mastered";
  }

  if (
    attempts >= 3 &&
    successRate >= 0.75
  ) {
    return "proficient";
  }

  if (successRate >= 0.5) {
    return "developing";
  }

  return "learning";
}

export async function setCurrentLesson(
  studentId: string,
  lessonId: string
): Promise<StudentProgress> {
  const progress =
    await getProgress(studentId);

  progress.currentLessonId = lessonId;

  return saveProgress(progress);
}