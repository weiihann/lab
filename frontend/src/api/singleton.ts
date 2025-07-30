import { createLabApiClient, LabApiClient } from '@/api/client.ts';
import fetchBootstrap from '@/bootstrap';

let client: LabApiClient | null = null;

/**
 * Get the singleton LabAPI client instance.
 * This function will initialize the client on first call and return the same instance on subsequent calls.
 */
export async function getLabApiClient(): Promise<LabApiClient> {
  // If client is already initialized, return it
  if (client) {
    return client;
  }

  try {
    // Get the backend URL from bootstrap
    const bootstrap = await fetchBootstrap();
    const baseUrl = bootstrap.backend.url;

    // Create the client using the URL from bootstrap
    client = createLabApiClient(baseUrl);

    return client;
  } catch (error) {
    console.error('Failed to initialize Lab API client:', error);
    throw error;
  }
}

/**
 * Reset the singleton client instance.
 * Useful for testing or when configuration changes.
 */
export function resetLabApiClient(): void {
  client = null;
}
