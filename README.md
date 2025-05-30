# ➕ Junction

This Deno project acts as a router-proxy for Ethereum JSON-RPC requests. It forwards incoming requests to one or more configured upstream RPC providers based on the request path (network / chain slug).

If more than one RPC is configured for a given network, it will automatically fail over requests to backup RPCs.

## Features

*   Forwards RPC requests to configured upstream providers.
*   Supports multiple upstream providers per network for failover.
*   Optional rate limiting for public requests (per IP).
*   Optional bypass token for internal/trusted requests (skips rate limiting).

## Configuration

Configuration is managed via environment variables, typically loaded from a `.env` file.

1.  **`RPC_CONFIG`**: (Required) A JSON string defining the network slugs and their corresponding upstream RPC endpoints.
    *   Format: `'{ "network_slug": [{ "url": "...", "authToken": "Bearer ..." }, ...], ... }'`
    *   `network_slug`: The path segment used to identify the network (e.g., `mainnet`, `sepolia`).
    *   `url`: The full URL of the upstream RPC provider.
    *   `authToken` (Optional): A Bearer token to include in the `Authorization` header for requests to this specific upstream.

    **Example `RPC_CONFIG`:**
    ```json
    {
      "mainnet": [
        { "url": "https://mainnet.infura.io/v3/YOUR_INFURA_ID" },
        { "url": "https://rpc.ankr.com/eth" }
      ],
      "sepolia": [
        { "url": "https://sepolia.infura.io/v3/YOUR_INFURA_ID" }
      ]
    }
    ```
    *(Remember to escape this JSON string properly if setting it directly as an environment variable outside a `.env` file)*

2.  **`INTERNAL_AUTH_TOKEN`**: (Optional) A secret Bearer token. Requests including `Authorization: Bearer <token>` with this value will bypass rate limiting and are required to access the `/metrics` endpoint.

3.  **`PUBLIC_RATE_LIMIT_ENABLED`**: (Optional) Set to `true` to enable rate limiting for requests without the `INTERNAL_AUTH_TOKEN`. Defaults to `false`.

4.  **`PUBLIC_RATE_LIMIT_RPM`**: (Optional) The maximum requests per minute allowed per IP address when rate limiting is enabled. Defaults to `60`.

## Running the Proxy

Ensure you have [Deno](https://deno.land/) installed.

1.  **Cache dependencies:**
    ```bash
    deno cache main.ts
    ```
2.  **Run the server:**
    ```bash
    deno run --allow-net --allow-env --allow-read [--env-file] [--] main.ts
    ```
    *   `--allow-net`: Required for listening for incoming requests, making outgoing RPC calls, and pushing to Pushgateway.
    *   `--allow-env`: Required to read environment variables.
    *   `--allow-read`: Required if using a `.env` file (though Deno reads env vars directly now, this flag might still be needed depending on exact Deno version/usage).
    *   `--env-file` (optional): Read and ingest `.env` file in the root dir to source environment variables.

The proxy will start listening on `http://localhost:8000`.

## Usage

Send standard JSON-RPC POST requests to the appropriate network path:

*   `http://localhost:8000/mainnet`
*   `http://localhost:8000/sepolia`
*   etc.
