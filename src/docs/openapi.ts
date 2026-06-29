import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Dragao Careca Admin API",
      version: "1.0.0",
      description: "Backend API with Google login and JWT-protected admin endpoints.",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        GoogleLoginRequest: {
          type: "object",
          required: ["idToken"],
          properties: {
            idToken: { type: "string", description: "Google ID token (credential)" },
          },
        },
        GoogleLoginResponse: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            user: {
              type: "object",
              properties: {
                email: { type: "string" },
                name: { type: "string" },
                picture: { type: "string" },
              },
            },
          },
        },
        Episode: {
          type: "object",
          required: ["episodeId", "title", "summary", "pubDate", "explicit"],
          properties: {
            episodeId: { type: "integer", example: 321 },
            title: { type: "string", example: "Episode title" },
            summary: { type: "string", example: "Episode summary" },
            pubDate: { type: "string", format: "date-time" },
            duration: { type: "string", example: "01:12:34" },
            explicit: { type: "string", enum: ["yes", "no"] },
            bytes: { type: "integer" },
            authors: { type: "array", items: { type: "string" } },
            guests: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            citations: { type: "array", items: { type: "string" } },
            fileName: { type: "string" },
            coverFileName: { type: "string" },
            coverLowFileName: { type: "string" },
            trailerFileName: { type: "string" },
            youtube: { type: "string" },
            spotifyId: { type: "string" },
            musicCredits: { type: "array", items: { type: "string" } },
            coverCredits: { type: "array", items: { type: "string" } },
          },
        },
        HealthStatus: {
          type: "object",
          required: ["status", "uptime", "bot"],
          properties: {
            status: { type: "string", example: "ok" },
            uptime: { type: "number", example: 1234.56 },
            bot: {
              type: "object",
              required: ["enabled", "running", "pendingLaunchNotifications", "nextPendingEpisode"],
              properties: {
                enabled: { type: "boolean" },
                running: { type: "boolean" },
                reason: { type: "string", nullable: true, example: "Missing or disabled Telegram config: TELEGRAM_BOT_TOKEN" },
                pendingLaunchNotifications: { type: "integer", example: 2 },
                lastQueuedAt: { type: "string", format: "date-time", nullable: true },
                nextPendingEpisode: {
                  oneOf: [
                    { type: "null" },
                    {
                      type: "object",
                      required: ["episodeId", "title", "pubDate"],
                      properties: {
                        episodeId: { type: "integer", example: 321 },
                        title: { type: "string", example: "Episode title" },
                        pubDate: { type: "string", format: "date-time" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        SpotifyMetricsSnapshot: {
          type: "object",
          properties: {
            source: { type: "string", example: "spotify-connector" },
            fetchedAt: { type: "string", format: "date-time" },
            metadata: { type: "object", additionalProperties: true },
            aggregate: { type: "object", additionalProperties: true },
            episodes: { type: "array", items: { type: "object", additionalProperties: true } },
            samplePerformance: { type: "object", nullable: true, additionalProperties: true },
          },
        },
        YouTubeMetricsSnapshot: {
          type: "object",
          properties: {
            source: { type: "string", example: "youtube-analytics" },
            fetchedAt: { type: "string", format: "date-time" },
            range: {
              type: "object",
              properties: {
                requestedDays: { type: "integer" },
                lookbackDays: { type: "integer" },
                currentStart: { type: "string", format: "date" },
                currentEnd: { type: "string", format: "date" },
                previousStart: { type: "string", format: "date" },
                previousEnd: { type: "string", format: "date" },
                timeZone: { type: "string" },
              },
            },
            channel: {
              type: "object",
              properties: {
                id: { type: "string" },
                url: { type: "string" },
              },
            },
            series: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  date: { type: "string", format: "date" },
                  views: { type: "number" },
                  estimatedMinutesWatched: { type: "number" },
                  subscribersGained: { type: "number" },
                  subscribersLost: { type: "number" },
                  likes: { type: "number" },
                  comments: { type: "number" },
                  shares: { type: "number" },
                },
              },
            },
            totals: {
              type: "object",
              properties: {
                views: { type: "number" },
                estimatedMinutesWatched: { type: "number" },
                subscribersGained: { type: "number" },
                subscribersLost: { type: "number" },
                netSubscribers: { type: "number" },
                likes: { type: "number" },
                comments: { type: "number" },
                shares: { type: "number" },
                averageViewDurationSeconds: { type: "number" },
              },
            },
            debug: { type: "object", nullable: true, additionalProperties: true },
          },
        },
        YouTubeMetricsErrorResponse: {
          type: "object",
          properties: {
            source: { type: "string", example: "youtube-analytics" },
            fetchedAt: { type: "string", format: "date-time" },
            ok: { type: "boolean", example: false },
            code: { type: "string", enum: ["disabled", "missing_credentials", "fetch_failed"] },
            message: { type: "string" },
            details: { type: "string", nullable: true },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthStatus" },
                },
              },
            },
          },
        },
      },
      "/v1/auth/google": {
        post: {
          tags: ["Auth"],
          summary: "Login with Google ID token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoogleLoginRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "JWT token issued",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GoogleLoginResponse" },
                },
              },
            },
            "400": { description: "Invalid token" },
          },
        },
      },
      "/v1/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Current authenticated user",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Current user" }, "401": { description: "Unauthorized" } },
        },
      },
      "/v1/feed": {
        get: {
          tags: ["Feed"],
          summary: "Public dynamic RSS feed",
          responses: { "200": { description: "RSS XML" } },
        },
      },
      "/v1/feed/preview": {
        get: {
          tags: ["Feed"],
          summary: "Feed preview with scheduled episodes",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "RSS XML" }, "401": { description: "Unauthorized" } },
        },
      },
      "/v1/feed/status": {
        get: {
          tags: ["Feed"],
          summary: "Feed counters and next scheduled episode",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Status" }, "401": { description: "Unauthorized" } },
        },
      },
      "/v1/metrics/spotify": {
        get: {
          tags: ["Metrics"],
          summary: "Spotify podcast analytics snapshot",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "days",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, default: 30 },
              description: "Lookback window in days for the current and comparison snapshots.",
            },
          ],
          responses: {
            "200": {
              description: "Snapshot",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SpotifyMetricsSnapshot" },
                },
              },
            },
            "400": { description: "Connector unavailable or misconfigured" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/v1/metrics/youtube": {
        get: {
          tags: ["Metrics"],
          summary: "YouTube Studio analytics snapshot",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "days",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, default: 90 },
              description: "Current-range window in days; the response includes twice that amount for local range slicing.",
            },
          ],
          responses: {
            "200": {
              description: "Snapshot",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/YouTubeMetricsSnapshot" },
                },
              },
            },
            "400": { description: "Connector unavailable or misconfigured" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/v1/episodes": {
        get: {
          tags: ["Episodes"],
          summary: "List episodes",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "Episodes list" }, "401": { description: "Unauthorized" } },
        },
        post: {
          tags: ["Episodes"],
          summary: "Create episode",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Episode" },
              },
            },
          },
          responses: { "201": { description: "Created" }, "401": { description: "Unauthorized" } },
        },
      },
      "/v1/episodes/{episodeId}": {
        get: {
          tags: ["Episodes"],
          summary: "Get one episode",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Episode" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
        put: {
          tags: ["Episodes"],
          summary: "Update episode",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Episode" },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
      "/v1/episodes/{episodeId}/audio": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode audio file",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "400": { description: "Invalid file" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
      "/v1/episodes/{episodeId}/trailer": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode trailer file",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "400": { description: "Invalid file" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
      "/v1/episodes/{episodeId}/cover": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode cover image",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "400": { description: "Invalid file" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
      "/v1/episodes/{episodeId}/cover-webp": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode cover image in webp",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated" }, "400": { description: "Invalid file" }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
    },
  },
  apis: [],
});
