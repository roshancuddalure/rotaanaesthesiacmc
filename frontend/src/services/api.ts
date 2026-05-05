const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function healthCheck(): Promise<{ status: string }> {
  return request<{ status: string }>("/api/health");
}

export function getMetadata(): Promise<unknown> {
  return request<unknown>("/api/v1/metadata");
}

