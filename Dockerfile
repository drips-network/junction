# Use the official Deno image
FROM denoland/deno:2.5.1

# Set the working directory
WORKDIR /app

# Define build-time arguments for environment variables
# These can be passed during the build process (e.g., --build-arg RPC_CONFIG='{...}')
ARG RPC_CONFIG
ARG INTERNAL_AUTH_TOKEN
ARG PUBLIC_RATE_LIMIT_ENABLED
ARG PUBLIC_RATE_LIMIT_RPM
ARG PROMETHEUS_URL="" # Add ARG for Pushgateway URL (optional)

# Set runtime environment variables from the build arguments
# These will be available to the Deno application when it runs
ENV RPC_CONFIG=$RPC_CONFIG
ENV INTERNAL_AUTH_TOKEN=$INTERNAL_AUTH_TOKEN
ENV PUBLIC_RATE_LIMIT_ENABLED=$PUBLIC_RATE_LIMIT_ENABLED
ENV PUBLIC_RATE_LIMIT_RPM=$PUBLIC_RATE_LIMIT_RPM
ENV PROMETHEUS_URL=$PROMETHEUS_URL

# Copy the application code
COPY . .

# Cache dependencies based on lock file (if it exists)
# Using main.ts ensures all imports are covered
RUN deno cache main.ts --frozen

# Expose the port the application listens on
EXPOSE 8000

# Define the command to run the application
# --allow-env is needed to read the ENV variables set above
# --allow-net is needed for serving requests and fetching upstream
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
