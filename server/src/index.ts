import express from "express";
import cors from "cors";

import { executeJava } from "./execution/JavaExecutionService";

import {
  getProgress,
  recordEvaluation,
  setCurrentLesson,
} from "./progress/ProgressStore";


const app = express();

const PORT = 3001;

// -----------------------------------------
// MIDDLEWARE
// -----------------------------------------

app.use(cors());

app.use(express.json());

// -----------------------------------------
// AUTH ROUTES
// -----------------------------------------

// -----------------------------------------
// HEALTH CHECK
// -----------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "NeuroCode backend",
  });
});

// -----------------------------------------
// JAVA EXECUTION
// -----------------------------------------

app.post("/api/execute", async (req, res) => {
  try {
    const { code, stdin } = req.body;

    if (typeof code !== "string") {
      return res.status(400).json({
        status: "error",
        stderr: "Code must be a string.",
      });
    }

    if (code.length > 10_000) {
      return res.status(400).json({
        status: "error",
        stderr:
          "Code is too large. Maximum size is 10,000 characters.",
      });
    }

    const result = await executeJava(code, {
      stdin: typeof stdin === "string" ? stdin : "",
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      status: "error",
      stdout: "",
      stderr:
        error instanceof Error
          ? error.message
          : "Unable to execute Java code.",
    });
  }
});

// -----------------------------------------
// GET STUDENT PROGRESS
// -----------------------------------------

app.get(
  "/api/progress/:studentId",
  async (req, res) => {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(400).json({
          error: "Student ID is required.",
        });
      }

      const progress = await getProgress(studentId);

      return res.json(progress);
    } catch (error) {
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to load progress.",
      });
    }
  }
);

// -----------------------------------------
// RECORD EVALUATION
// -----------------------------------------

app.post(
  "/api/progress/evaluation",
  async (req, res) => {
    try {
      const {
        studentId,
        lessonId,
        conceptIds,
        correct,
      } = req.body;

      if (typeof studentId !== "string") {
        return res.status(400).json({
          error: "studentId must be a string.",
        });
      }

      if (typeof lessonId !== "string") {
        return res.status(400).json({
          error: "lessonId must be a string.",
        });
      }

      if (!Array.isArray(conceptIds)) {
        return res.status(400).json({
          error: "conceptIds must be an array.",
        });
      }

      if (typeof correct !== "boolean") {
        return res.status(400).json({
          error: "correct must be a boolean.",
        });
      }

      const progress = await recordEvaluation(
        studentId,
        lessonId,
        conceptIds,
        correct
      );

      return res.json(progress);
    } catch (error) {
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to record evaluation.",
      });
    }
  }
);

// -----------------------------------------
// SET CURRENT LESSON
// -----------------------------------------

app.post(
  "/api/progress/current-lesson",
  async (req, res) => {
    try {
      const {
        studentId,
        lessonId,
      } = req.body;

      if (typeof studentId !== "string") {
        return res.status(400).json({
          error: "studentId must be a string.",
        });
      }

      if (typeof lessonId !== "string") {
        return res.status(400).json({
          error: "lessonId must be a string.",
        });
      }

      const progress = await setCurrentLesson(
        studentId,
        lessonId
      );

      return res.json(progress);
    } catch (error) {
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to update current lesson.",
      });
    }
  }
);

// -----------------------------------------
// START SERVER
// -----------------------------------------

app.listen(PORT, () => {
  console.log(
    `NeuroCode backend running at http://localhost:${PORT}`
  );
});