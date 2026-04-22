const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "";

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/**
 * Shared fetch wrapper that prepends API_BASE_URL, includes credentials,
 * and handles JSON serialization / error responses.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options?: ApiFetchOptions
): Promise<T> {
  const { body, headers, ...rest } = options ?? {};

  const isFormData = body instanceof FormData;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body !== undefined
      ? { body: isFormData ? body : JSON.stringify(body) }
      : {}),
    ...rest,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw error;
  }

  const json = await res.json();
  return json as T;
}
