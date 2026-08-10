import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  mkdir,
  writeFile,
  rm,
} from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const JAVA_HOME =
  "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot";

const JAVAC_PATH = path.join(
  JAVA_HOME,
  "bin",
  "javac.exe"
);

const JAVA_PATH = path.join(
  JAVA_HOME,
  "bin",
  "java.exe"
);

const COMPILE_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 3000;
const MAX_OUTPUT_SIZE = 1024 * 1024;

export interface JavaExecutionResult {
  status:
    | "success"
    | "compile_error"
    | "runtime_error"
    | "timeout"
    | "error";

  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
}

export interface JavaExecutionOptions {
  stdin?: string;
}

export async function executeJava(
  code: string,
  options: JavaExecutionOptions = {}
): Promise<JavaExecutionResult> {
  const startTime = Date.now();

  const tempDirectory = path.join(
    os.tmpdir(),
    `neurocode-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );

  const javaFile = path.join(
    tempDirectory,
    "Main.java"
  );

  try {
    await mkdir(tempDirectory, {
      recursive: true,
    });

    await writeFile(
      javaFile,
      code,
      "utf8"
    );

    // -----------------------------------------
    // COMPILE
    // -----------------------------------------

    try {
      await execFileAsync(
        JAVAC_PATH,
        [javaFile],
        {
          cwd: tempDirectory,
          timeout: COMPILE_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_SIZE,
        }
      );
    } catch (error: any) {
      return {
        status: "compile_error",
        stdout: error.stdout ?? "",
        stderr:
          error.stderr ??
          error.message ??
          "Compilation failed.",
        exitCode:
          typeof error.code === "number"
            ? error.code
            : null,
        executionTimeMs:
          Date.now() - startTime,
      };
    }

    // -----------------------------------------
    // RUN
    // -----------------------------------------

    return await runJavaProgram(
      tempDirectory,
      options.stdin ?? "",
      startTime
    );
  } catch (error) {
    return {
      status: "error",
      stdout: "",
      stderr:
        error instanceof Error
          ? error.message
          : "Unable to execute Java code.",
      exitCode: null,
      executionTimeMs:
        Date.now() - startTime,
    };
  } finally {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
}

function runJavaProgram(
  workingDirectory: string,
  stdin: string,
  startTime: number
): Promise<JavaExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(
      JAVA_PATH,
      [
        "-Xmx128m",
        "-Djava.net.useSystemProxies=false",
        "Main",
      ],
      {
        cwd: workingDirectory,
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;

      child.kill();

      resolve({
        status: "timeout",
        stdout,
        stderr:
          "Your program took too long to run.",
        exitCode: null,
        executionTimeMs:
          Date.now() - startTime,
      });
    }, RUN_TIMEOUT_MS);

    const finish = (
      result: JavaExecutionResult
    ) => {
      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeout);

      resolve(result);
    };

    child.stdout.on(
      "data",
      (data: Buffer) => {
        if (finished) {
          return;
        }

        stdout += data.toString();

        if (
          Buffer.byteLength(
            stdout,
            "utf8"
          ) > MAX_OUTPUT_SIZE
        ) {
          child.kill();

          finish({
            status: "error",
            stdout: stdout.slice(
              0,
              MAX_OUTPUT_SIZE
            ),
            stderr:
              "Your program produced too much output.",
            exitCode: null,
            executionTimeMs:
              Date.now() - startTime,
          });
        }
      }
    );

    child.stderr.on(
      "data",
      (data: Buffer) => {
        if (finished) {
          return;
        }

        stderr += data.toString();

        if (
          Buffer.byteLength(
            stderr,
            "utf8"
          ) > MAX_OUTPUT_SIZE
        ) {
          child.kill();

          finish({
            status: "error",
            stdout,
            stderr: stderr.slice(
              0,
              MAX_OUTPUT_SIZE
            ),
            exitCode: null,
            executionTimeMs:
              Date.now() - startTime,
          });
        }
      }
    );

    child.on("error", (error) => {
      finish({
        status: "error",
        stdout,
        stderr:
          error.message ||
          "Unable to start the Java program.",
        exitCode: null,
        executionTimeMs:
          Date.now() - startTime,
      });
    });

    child.on("close", (exitCode) => {
      if (finished) {
        return;
      }

      if (exitCode === 0) {
        finish({
          status: "success",
          stdout,
          stderr,
          exitCode: 0,
          executionTimeMs:
            Date.now() - startTime,
        });

        return;
      }

      finish({
        status: "runtime_error",
        stdout,
        stderr:
          stderr ||
          "Your program encountered a runtime error.",
        exitCode,
        executionTimeMs:
          Date.now() - startTime,
      });
    });

    // -----------------------------------------
    // SEND INPUT TO PROGRAM
    // -----------------------------------------

    if (stdin.length > 0) {
      child.stdin.write(stdin);
    }

    // Closing stdin tells Scanner there is
    // no additional input coming.
    child.stdin.end();
  });
}
