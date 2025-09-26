const RPC_TIMEOUT_MS = 10000; // 10 seconds timeout for upstream RPC calls

export interface RpcEndpoint {
  url: string;
  authToken?: string;
}

export interface RpcForwardResult {
  success: boolean;
  response?: Response;
  error?: {
    status: number;
    body: string;
  };
}

/**
 * Forwards a JSON-RPC request to a single upstream endpoint with timeout handling.
 * 
 * @param endpoint The RPC endpoint configuration
 * @param requestBody The JSON-RPC request body to forward
 * @param networkSlug The network identifier for logging
 * @returns Result of the RPC forwarding attempt
 */
export async function forwardToRpcEndpoint(
  endpoint: RpcEndpoint,
  requestBody: any,
  networkSlug: string
): Promise<RpcForwardResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    if (endpoint.authToken) {
      headers.set("Authorization", endpoint.authToken);
    }

    console.log(`[${networkSlug}] Attempting RPC: ${endpoint.url}`);

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBodyText = await response.text();

    if (response.ok) {
      let responseBodyJson;
      try {
        responseBodyJson = JSON.parse(responseBodyText);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[${networkSlug}] Failed to parse JSON response from ${endpoint.url}: ${message}. Body: ${responseBodyText.substring(0, 200)}...`);

        return {
          success: false,
          error: {
            status: 502,
            body: `Bad Gateway: Upstream response from ${endpoint.url} was not valid JSON.`
          }
        };
      }

      if (responseBodyJson && typeof responseBodyJson === 'object' && 'error' in responseBodyJson) {
        console.warn(`[${networkSlug}] RPC ${endpoint.url} returned error in response body: ${JSON.stringify(responseBodyJson.error).substring(0, 200)}...`);

        return {
          success: false,
          error: {
            status: response.status,
            body: responseBodyText
          }
        };
      }

      console.log(`[${networkSlug}] <-- Success from ${endpoint.url} (Status: ${response.status}, Response: ${responseBodyText.substring(0, 200)}${responseBodyText.length > 200 ? '...' : ''})`);

      return {
        success: true,
        response: new Response(JSON.stringify(responseBodyJson), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        })
      };
    } else {
      console.warn(`[${networkSlug}] Failed RPC ${endpoint.url}: Status ${response.status}, Body: ${responseBodyText.substring(0, 100)}...`);

      return {
        success: false,
        error: {
          status: response.status,
          body: responseBodyText
        }
      };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[${networkSlug}] Failed RPC ${endpoint.url}: Timeout after ${RPC_TIMEOUT_MS}ms`);

      return {
        success: false,
        error: {
          status: 504,
          body: `Gateway Timeout: Upstream endpoint ${endpoint.url} did not respond in time.`
        }
      };
    } else {
      console.warn(`[${networkSlug}] Failed RPC ${endpoint.url}: Network/Fetch error: ${errorMessage}`);

      return {
        success: false,
        error: {
          status: 502,
          body: `Bad Gateway: Could not connect to upstream endpoint ${endpoint.url}.`
        }
      };
    }
  }
}

/**
 * Attempts to forward a request to multiple RPC endpoints with fallback behavior.
 * Returns the first successful response, or the last error if all endpoints fail.
 * 
 * @param endpoints Array of RPC endpoints to try
 * @param requestBody The JSON-RPC request body to forward  
 * @param networkSlug The network identifier for logging
 * @returns The final response to return to the client
 */
export async function forwardWithFallback(
  endpoints: RpcEndpoint[],
  requestBody: any,
  networkSlug: string
): Promise<Response> {
  let lastError: { status: number; body: string } | null = null;

  for (const endpoint of endpoints) {
    const result = await forwardToRpcEndpoint(endpoint, requestBody, networkSlug);
    
    if (result.success && result.response) {
      return result.response;
    } else if (result.error) {
      lastError = result.error;
    }
  }

  if (lastError) {
    console.error(`[${networkSlug}] <-- All upstream RPCs failed. Returning last recorded error (Status: ${lastError.status}).`);

    return new Response(lastError.body, {
      status: lastError.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Fallback in the unlikely event that the endpoints list was empty and the loop never ran.
  console.error(`[${networkSlug}] <-- All upstream RPCs failed (no endpoints attempted).`);
  return new Response(`Bad Gateway: No configured RPC endpoints for network '${networkSlug}' could be reached.`, { status: 502 });
}