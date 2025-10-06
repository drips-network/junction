const networkPattern = new URLPattern({ pathname: "/:slug" });

export interface RouteMatch {
  slug: string;
  isValid: boolean;
}

/**
 * Extracts the network slug from a request URL using URL pattern matching.
 * 
 * @param url The request URL to parse
 * @returns Route match result with extracted slug and validity
 */
export function extractNetworkSlug(url: string): RouteMatch {
  const urlObj = new URL(url);
  const match = networkPattern.exec(urlObj);
  
  const slug = match?.pathname?.groups?.slug;
  
  if (!slug) {
    return { slug: "unknown", isValid: false };
  }
  
  return { slug, isValid: true };
}

/**
 * Validates that the requested network is configured in the RPC config.
 * 
 * @param slug The network slug to validate
 * @param rpcConfig The RPC configuration object
 * @returns True if the network is configured, false otherwise
 */
export function isNetworkConfigured(slug: string, rpcConfig: Record<string, any[]>): boolean {
  return slug in rpcConfig && Array.isArray(rpcConfig[slug]) && rpcConfig[slug].length > 0;
}