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
        EpisodeArtifactJobSnapshot: {
          type: "object",
          description: "Public state of an asynchronous final-artifact ZIP job. Internal archive and snapshot paths are never exposed.",
          required: ["jobId", "episodeId", "requested", "available", "missing", "state", "progress", "stateText", "queuePosition", "downloadUrl", "expiresAt", "error", "createdAt", "updatedAt"],
          properties: {
            jobId: { type: "string", description: "Opaque job identifier." },
            episodeId: { type: "integer", minimum: 1 },
            requested: { type: "array", items: { type: "string", enum: ["episode", "trailer", "transcript", "image", "image-low"] }, description: "Normalized requested selectors in catalog order." },
            available: { type: "array", items: { type: "string", enum: ["episode", "trailer", "transcript", "image", "image-low"] }, description: "Requested final artifacts included in the archive when ready." },
            missing: { type: "array", items: { type: "string", enum: ["episode", "trailer", "transcript", "image", "image-low"] }, description: "Requested final artifacts unavailable at preparation time." },
            state: { type: "string", enum: ["pending", "processing", "completed", "failed"] },
            progress: { type: "integer", minimum: 0, maximum: 100, description: "Server-side ZIP assembly percentage derived from Archiver source bytes; never browser transfer progress. Processing is capped below 100 until atomic archive publication completes." },
            stateText: { type: "string", description: "Human-readable job state text." },
            queuePosition: { type: "integer", minimum: 1, nullable: true, description: "Queue position only while state is pending; otherwise null." },
            downloadUrl: { type: "string", nullable: true, description: "Protected download URL only while state is completed; otherwise null." },
            expiresAt: { type: "string", format: "date-time", nullable: true, description: "Completed archive expiry exactly 24 hours after atomic publication; null before completion." },
            error: { type: "string", nullable: true, description: "Generic safe failure message for failed jobs; otherwise null. Internal filesystem and diagnostic details are never returned." },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        PublicEpisodeCatalogGuest: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", example: "Convidado Especial" },
          },
        },
        PublicEpisodeReferenceLink: {
          type: "object",
          required: ["label", "url"],
          properties: {
            label: { type: "string", example: "instagram" },
            url: { type: "string", format: "uri", example: "https://www.instagram.com/dragaocareca" },
          },
        },
        PublicEpisodeReference: {
          type: "object",
          required: ["name", "links"],
          properties: {
            name: { type: "string", example: "Convidado Especial" },
            links: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeReferenceLink" },
            },
          },
        },
        PublicEpisodeCoverCredit: {
          type: "object",
          required: ["name", "member"],
          properties: {
            name: { type: "string", example: "Gabriel Moraes" },
            member: { type: "boolean", example: true },
          },
        },
        PublicEpisodeCatalogItem: {
          type: "object",
          required: ["episodeId", "title", "summary", "pubDate", "guests", "pageUrl", "audioUrl", "coverUrl", "trailerUrl"],
          properties: {
            episodeId: { type: "integer", example: 344 },
            title: { type: "string", example: "Episodio 344" },
            summary: { type: "string", example: "Resumo publico do episodio." },
            pubDate: { type: "string", format: "date-time" },
            guests: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeCatalogGuest" },
            },
            pageUrl: { type: "string", format: "uri", example: "https://dragaocareca.com/#/episode/344" },
            audioUrl: { type: "string", format: "uri", nullable: true, example: "https://www.dragaocareca.com/files/episodes/episode_344.mp3" },
            coverUrl: { type: "string", format: "uri", nullable: true, example: "https://www.dragaocareca.com/files/images/episode_344.jpeg" },
            trailerUrl: { type: "string", format: "uri", nullable: true, example: "https://dragaocareca.com/media/trailers/trailer_344.mp3" },
          },
        },
        PublicEpisodeDetail: {
          type: "object",
          required: [
            "episodeId",
            "title",
            "summary",
            "pubDate",
            "duration",
            "explicit",
            "authors",
            "guests",
            "citations",
            "musicCredits",
            "coverCredits",
            "pageUrl",
            "audioUrl",
            "downloadUrl",
            "coverUrl",
            "trailerUrl",
            "youtubeUrl",
            "youtubeEmbedUrl",
            "spotifyId",
            "spotifyEmbedUrl",
          ],
          properties: {
            episodeId: { type: "integer", example: 344 },
            title: { type: "string", example: "DC 328 - Jogando um jogo sobre jogos | DC 328" },
            summary: { type: "string", example: "Resumo publico do episodio." },
            pubDate: { type: "string", format: "date-time" },
            duration: { type: "string", nullable: true, example: "01:04:47" },
            explicit: { type: "string", enum: ["yes", "no"] },
            authors: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeCatalogGuest" },
            },
            guests: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeReference" },
            },
            citations: {
              type: "array",
              items: { type: "string" },
            },
            musicCredits: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeReference" },
            },
            coverCredits: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicEpisodeCoverCredit" },
            },
            pageUrl: { type: "string", format: "uri", example: "https://dragaocareca.com/#/episode/344" },
            audioUrl: { type: "string", format: "uri", nullable: true },
            downloadUrl: { type: "string", format: "uri", nullable: true },
            coverUrl: { type: "string", format: "uri", nullable: true },
            trailerUrl: { type: "string", format: "uri", nullable: true },
            youtubeUrl: { type: "string", format: "uri", nullable: true },
            youtubeEmbedUrl: { type: "string", format: "uri", nullable: true },
            spotifyId: { type: "string", nullable: true, example: "4Qps7LshTGJVTf0x3UYlJf" },
            spotifyEmbedUrl: { type: "string", format: "uri", nullable: true },
          },
        },
        PublicSupportersResponse: {
          type: "object",
          required: ["supportUrl", "supporters"],
          properties: {
            supportUrl: { type: "string", format: "uri", example: "http://bit.ly/guildadc" },
            supporters: {
              type: "array",
              items: { type: "string", example: "Ana Flavia Sagan Lucena Rodrigues de Moraes" },
            },
          },
        },
        PublicAboutResponse: {
          type: "object",
          required: ["title", "description"],
          properties: {
            title: { type: "string", example: "Dragão Careca" },
            description: { type: "string", example: "Podcast de humor com temática de RPG, cultura pop e aventuras improvisadas." },
          },
        },
        PublicContactResponse: {
          type: "object",
          required: ["email", "characterSheetsBaseUrl"],
          properties: {
            email: { type: "string", example: "contato@dragaocareca.com" },
            characterSheetsBaseUrl: { type: "string", format: "uri", example: "https://ficha.dragaocareca.com/#" },
          },
        },
        PublicSiteConfigResponse: {
          type: "object",
          required: [
            "email",
            "supportersUrl",
            "characterSheetsBaseUrl",
            "maxEpisodesPerPage",
            "transitionTimeMs",
            "disqus",
          ],
          properties: {
            email: { type: "string", example: "contato@dragaocareca.com" },
            supportersUrl: { type: "string", format: "uri", example: "http://bit.ly/guildadc" },
            characterSheetsBaseUrl: { type: "string", format: "uri", example: "https://ficha.dragaocareca.com/#" },
            maxEpisodesPerPage: { type: "integer", example: 10 },
            transitionTimeMs: { type: "integer", example: 7000 },
            disqus: {
              type: "object",
              required: ["shortName"],
              properties: {
                shortName: { type: "string", example: "dragaocareca" },
              },
            },
          },
        },
        PublicSocialResponse: {
          type: "object",
          required: [
            "twitter",
            "youtube",
            "instagram",
            "facebook",
            "spotify",
            "deezer",
            "googlePodcasts",
            "applePodcasts",
            "pocketCast",
            "castBox",
            "rss",
          ],
          properties: {
            twitter: { type: "string", format: "uri" },
            youtube: { type: "string", format: "uri" },
            instagram: { type: "string", format: "uri" },
            facebook: { type: "string", format: "uri" },
            spotify: { type: "string", format: "uri" },
            deezer: { type: "string", format: "uri" },
            googlePodcasts: { type: "string", format: "uri" },
            applePodcasts: { type: "string", format: "uri" },
            pocketCast: { type: "string", format: "uri" },
            castBox: { type: "string", format: "uri" },
            rss: { type: "string", format: "uri" },
          },
        },
        PublicAuthorContact: {
          type: "object",
          required: ["name", "character", "contacts"],
          properties: {
            name: { type: "string", example: "Jhonatt Lima" },
            character: { type: "string", nullable: true, example: "Tiamat" },
            contacts: {
              type: "object",
              additionalProperties: {
                type: "string",
                format: "uri",
              },
            },
          },
        },
        PublicContactsResponse: {
          type: "object",
          required: ["authors"],
          properties: {
            authors: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicAuthorContact" },
            },
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
      "/v1/public/episodes": {
        get: {
          tags: ["Public"],
          summary: "Published public episode catalog",
          description: "Returns the full published episode catalog as a plain JSON array ordered from newest to oldest.",
          responses: {
            "200": {
              description: "Published episodes ordered newest-first",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PublicEpisodeCatalogItem" },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/public/episodes/{episodeId}": {
        get: {
          tags: ["Public"],
          summary: "Published public episode detail",
          description: "Returns one published episode with frontend-ready media, credit, and embed fields.",
          parameters: [
            {
              name: "episodeId",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": {
              description: "Published episode detail payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicEpisodeDetail" },
                },
              },
            },
            "400": {
              description: "Invalid episodeId",
            },
            "404": {
              description: "Episode not found or not yet published",
            },
          },
        },
      },
      "/v1/public/supporters": {
        get: {
          tags: ["Public"],
          summary: "Public supporters page data",
          description: "Returns the guild/support link and the current supporters list as JSON.",
          responses: {
            "200": {
              description: "Supporters payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicSupportersResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/public/about": {
        get: {
          tags: ["Public"],
          summary: "Public about page data",
          responses: {
            "200": {
              description: "About payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicAboutResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/public/contact": {
        get: {
          tags: ["Public"],
          summary: "Public contact page data",
          responses: {
            "200": {
              description: "Contact payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicContactResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/public/site-config": {
        get: {
          tags: ["Public"],
          summary: "Public shared frontend config",
          responses: {
            "200": {
              description: "Shared public config payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicSiteConfigResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/public/social": {
        get: {
          tags: ["Public"],
          summary: "Public social links",
          responses: {
            "200": {
              description: "Social links payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicSocialResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/public/contacts": {
        get: {
          tags: ["Public"],
          summary: "Public author contacts",
          responses: {
            "200": {
              description: "Author contacts payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicContactsResponse" },
                },
              },
            },
          },
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
      "/v1/episodes/{episodeId}/artifacts/jobs": {
        post: {
          tags: ["Episodes"],
          summary: "Start an episode artifact ZIP job",
          description: "Starts or reuses an authenticated server-side ZIP job. An omitted JSON body, or an object with omitted artifacts, selects every catalog artifact. A supplied artifacts value must be a nonempty canonical selector array; paths, filenames, and internal media kinds are not accepted. Ready reuse and download revalidate streamed SHA-256 evidence and explicit missing markers for every selected final source. Poll the Location URL. JSON responses use Cache-Control: no-store and completed archives expire exactly 24 hours after atomic publication.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    artifacts: { type: "array", minItems: 1, description: "Optional. Omit this property (or the entire JSON body) to select all catalog artifacts.", items: { type: "string", enum: ["episode", "trailer", "transcript", "image", "image-low"] }, example: ["episode", "transcript"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "An existing completed job was reused.", headers: { "Cache-Control": { description: "no-store", schema: { type: "string", example: "no-store" } }, Location: { description: "Status URL for the job.", schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/EpisodeArtifactJobSnapshot" } } } },
            "202": { description: "A new or already-active job is pending or processing.", headers: { "Cache-Control": { description: "no-store", schema: { type: "string", example: "no-store" } }, Location: { description: "Status URL for the job.", schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/EpisodeArtifactJobSnapshot" } } } },
            "400": { description: "Invalid positive episodeId, JSON body, or artifact selector array." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "Either `{ message: \"Episode not found\" }` or `{ message: \"No requested artifacts found\" }`." },
          },
        },
      },
      "/v1/episodes/{episodeId}/artifacts/jobs/{jobId}": {
        get: {
          tags: ["Episodes"],
          summary: "Poll an episode artifact ZIP job",
          description: "Returns the public pending, processing, completed, or failed snapshot only. Unknown, expired, and episode/job-mismatched identifiers return the same 404 response. Cache-Control is no-store.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." },
            { name: "jobId", in: "path", required: true, schema: { type: "string", minLength: 1 }, description: "Opaque job identifier returned by the start operation." },
          ],
          responses: {
            "200": { description: "Current public job snapshot.", headers: { "Cache-Control": { description: "no-store", schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/EpisodeArtifactJobSnapshot" } } } },
            "400": { description: "Invalid positive episodeId." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "`{ message: \"Artifact job not found\" }` for an unknown, expired, or mismatched job." },
          },
        },
      },
      "/v1/episodes/{episodeId}/artifacts/jobs/{jobId}/download": {
        get: {
          tags: ["Episodes"],
          summary: "Download a ready final-artifact ZIP archive",
          description: "Streams only a revalidated completed job archive. The response is no-store, uses a server-generated safe filename, and includes only selector names in X-Missing-Artifacts. Expired jobs return the same 404 as unknown or mismatched jobs.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." },
            { name: "jobId", in: "path", required: true, schema: { type: "string", minLength: 1 }, description: "Opaque job identifier." },
          ],
          responses: {
            "200": { description: "ZIP archive containing available requested final artifacts.", headers: { "Cache-Control": { description: "no-store", schema: { type: "string", example: "no-store" } }, "Content-Disposition": { description: "Deterministic attachment filename: episode-{episodeId}-artifacts.zip.", schema: { type: "string" } }, "X-Missing-Artifacts": { description: "Comma-separated selector names for requested final artifacts that were unavailable.", schema: { type: "string" } } }, content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
            "400": { description: "Invalid positive episodeId." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "`{ message: \"Artifact job not found\" }` for an unknown, expired, or mismatched job." },
            "409": { description: "`{ message: \"Artifact archive is not ready\" }` while pending, processing, or failed." },
          },
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
