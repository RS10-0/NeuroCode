import { supabase } from "./supabase";

const API_URL =
  "http://localhost:3001";

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error(
      "You must be logged in to access progress."
    );
  }

  return session.access_token;
}

async function authenticatedFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token =
    await getAccessToken();

  const headers = new Headers(
    options.headers
  );

  headers.set(
    "Authorization",
    `Bearer ${token}`
  );

  headers.set(
    "Content-Type",
    "application/json"
  );

  return fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers,
    }
  );
}

export async function getProgress() {
  const response =
    await authenticatedFetch(
      "/api/progress"
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Unable to load progress."
    );
  }

  return data;
}

export async function recordEvaluation(
  lessonId: string,
  conceptIds: string[],
  correct: boolean
) {
  const response =
    await authenticatedFetch(
      "/api/progress/evaluation",
      {
        method: "POST",
        body: JSON.stringify({
          lessonId,
          conceptIds,
          correct,
        }),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Unable to record evaluation."
    );
  }

  return data;
}

export async function setCurrentLesson(
  lessonId: string
) {
  const response =
    await authenticatedFetch(
      "/api/progress/current-lesson",
      {
        method: "POST",
        body: JSON.stringify({
          lessonId,
        }),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Unable to update current lesson."
    );
  }

  return data;
}