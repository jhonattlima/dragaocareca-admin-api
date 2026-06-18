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
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health check",
          responses: { "200": { description: "OK" } },
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
