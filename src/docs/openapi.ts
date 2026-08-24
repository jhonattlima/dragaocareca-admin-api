import swaggerJsdoc from "swagger-jsdoc";
import {
  getPromotionContractProjection,
  PROMOTION_CONTRACT_SOURCE_REVISION,
  PROMOTION_CONTRACT_VERSION,
  type PromotionContractProjection,
} from "../schemas/episode-promotion";

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
        promotionServiceAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "service-token",
          description: "Dedicated private API-to-bot service credential. User JWT and AUTH_BYPASS are not valid for this boundary.",
        },
      },
      schemas: {
        PromotionError: {
          type: "object",
          additionalProperties: false,
          required: ["category", "description", "retryable"],
          properties: {
            category: {
              type: "string",
              enum: ["malformed_payload", "authentication", "permission", "missing_media", "digest_mismatch", "timeout", "transport", "telegram_service", "unknown"],
            },
            description: { type: "string", minLength: 1, maxLength: 500, description: "Safe bounded description; credentials, paths, raw provider responses, and chat identifiers are excluded." },
            retryable: { type: "boolean" },
          },
        },
        PromotionDestinationAcknowledgement: {
          type: "object",
          additionalProperties: false,
          required: ["destination", "status"],
          properties: {
            destination: { type: "string", enum: ["guild_trailer", "advance_access"] },
            status: { type: "string", enum: ["complete", "replayed", "temporary_failure", "permanent_failure", "unknown"] },
            message_id: { type: "string", nullable: true, maxLength: 128 },
            file_id: { type: "string", nullable: true, maxLength: 256 },
            topic_id: { type: "string", nullable: true, maxLength: 128 },
            message_thread_id: { type: "string", nullable: true, maxLength: 128 },
            acknowledged_at: { type: "string", format: "date-time", nullable: true },
            error: { allOf: [{ $ref: "#/components/schemas/PromotionError" }], nullable: true },
          },
        },
        PromotionAcknowledgement: {
          type: "object",
          additionalProperties: false,
          required: ["contract_version", "notification_id", "status", "effects"],
          properties: {
            contract_version: { type: "string", enum: [PROMOTION_CONTRACT_VERSION] },
            notification_id: { type: "string", pattern: "^episode:[1-9][0-9]*$" },
            status: { type: "string", enum: ["complete", "replayed", "temporary_failure", "permanent_failure", "unknown"] },
            effects: { type: "array", minItems: 1, maxItems: 2, items: { $ref: "#/components/schemas/PromotionDestinationAcknowledgement" } },
          },
        },
        PromotionRequest: {
          type: "object",
          additionalProperties: false,
          required: ["contract_version", "source_revision", "notification_id", "episode_id", "episode_number", "title", "public_download_url", "trailer", "destinations"],
          properties: {
            contract_version: { type: "string", enum: [PROMOTION_CONTRACT_VERSION] },
            source_revision: { type: "string", pattern: `^${PROMOTION_CONTRACT_SOURCE_REVISION}:[a-f0-9]{64}$` },
            notification_id: { type: "string", pattern: "^episode:[1-9][0-9]*$" },
            episode_id: { type: "integer", minimum: 1 },
            episode_number: { type: "integer", minimum: 1 },
            title: { type: "string", minLength: 1, maxLength: 300, description: "Hashtag-free API-prepared title." },
            public_download_url: { type: "string", format: "uri" },
            trailer: {
              type: "object",
              additionalProperties: false,
              required: ["media_reference", "sha256", "byte_count", "mime_type"],
              properties: {
                media_reference: { type: "string", pattern: "^episodes/[1-9][0-9]*/trailer\\.mp4$", description: "Logical reference only; never a host path or public/static media URL." },
                sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
                byte_count: { type: "integer", minimum: 1 },
                mime_type: { type: "string", enum: ["video/mp4"] },
              },
            },
            destinations: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["guild_trailer", "advance_access"] } },
          },
        },
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
            duration: { type: "string", pattern: "^\\d{2}:\\d{2}:\\d{2}$", example: "01:12:34", description: "Backend-confirmed episode-audio duration in HH:MM:SS format." },
            explicit: { type: "string", enum: ["yes", "no"] },
            bytes: { type: "integer", minimum: 0, description: "Backend-confirmed byte count for the episode audio file." },
            authors: { type: "array", items: { type: "string" } },
            guests: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            citations: { type: "array", items: { type: "string" } },
            fileName: { type: "string" },
            coverFileName: { type: "string" },
            coverLowFileName: { type: "string" },
            trailerFileName: { type: "string" },
            trailerVideoFileName: { type: "string", description: "Server-derived final trailer-video reference, always episodes/{episodeId}/trailer.mp4 when present." },
            trailerVideoSyncStatus: { type: "string", enum: ["unpublished", "manual-sync-required", "synced"], description: "Publication state for the final trailer video. manual-sync-required means a local replacement needs an administrator-triggered YouTube re-sync." },
            youtube: { type: "string" },
            spotifyId: { type: "string" },
            musicCredits: { type: "array", minItems: 1, items: { type: "string" }, description: "At least one structured credit with a trimmed name and at least one trimmed reference URL is required for episode create/update." },
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
            requested: { type: "array", items: { type: "string", enum: ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"] }, description: "Normalized requested selectors in catalog order. trailer-video selects only canonical final trailer.mp4." },
            available: { type: "array", items: { type: "string", enum: ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"] }, description: "Requested final artifacts included in the archive when ready; trailer-video is canonical final trailer.mp4 only." },
            missing: { type: "array", items: { type: "string", enum: ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"] }, description: "Requested final artifacts unavailable at preparation time. trailer-video never accepts a client path or filename." },
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
        YoutubeTrailerJobSnapshot: {
          type: "object",
          description: "Safe protected snapshot for an API-owned private YouTube trailer transfer. Provider credentials, resumable session locations, provider identifiers, raw provider responses/errors, source fingerprints, and filesystem paths are never returned.",
          required: ["jobId", "episodeId", "status", "progress", "cancellation", "error", "retry", "createdAt", "updatedAt", "completedAt", "privateWatchUrl"],
          properties: {
            jobId: { type: "string", format: "uuid", description: "Opaque durable job identifier." },
            episodeId: { type: "integer", minimum: 1 },
            status: { type: "string", enum: ["queued", "claimed", "transferring", "processing", "ready", "failed", "cancel_requested", "cancelled", "obsolete"] },
            progress: {
              type: "object",
              required: ["confirmedBytes", "totalBytes", "processingPartsProcessed", "processingPartsTotal", "processingTimeLeftMs"],
              properties: {
                confirmedBytes: { type: "integer", minimum: 0, description: "Durably confirmed server-to-provider bytes, not browser upload progress." },
                totalBytes: { type: "integer", minimum: 0 },
                processingPartsProcessed: { type: "integer", minimum: 0, nullable: true },
                processingPartsTotal: { type: "integer", minimum: 0, nullable: true },
                processingTimeLeftMs: { type: "integer", minimum: 0, nullable: true },
              },
            },
            cancellation: {
              type: "object",
              required: ["requestedAt", "cancelledAt", "boundary"],
              properties: {
                requestedAt: { type: "string", format: "date-time", nullable: true },
                cancelledAt: { type: "string", format: "date-time", nullable: true },
                boundary: { type: "string", enum: ["local-cancelled", "provider-video-retained"], nullable: true, description: "provider-video-retained means provider acceptance may have occurred; local cancellation does not claim remote deletion." },
              },
            },
            error: { type: "object", required: ["category", "occurredAt"], properties: { category: { type: "string", nullable: true, description: "Normalized error category only; raw provider messages and responses are withheld." }, occurredAt: { type: "string", format: "date-time", nullable: true } } },
            retry: { type: "object", required: ["count", "nextAttemptAt"], properties: { count: { type: "integer", minimum: 0 }, nextAttemptAt: { type: "string", format: "date-time", nullable: true } } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            completedAt: { type: "string", format: "date-time", nullable: true },
            privateWatchUrl: { type: "string", format: "uri", nullable: true, description: "Sanitized private YouTube watch URL only after provider video evidence exists; never a public-publishing signal." },
            publicationStatus: { type: "string", enum: ["not_started", "metadata_accepted", "playlist_confirmed", "public_confirmed", "failed"] },
            publicationErrorCategory: { type: "string", nullable: true },
          },
        },
        YoutubeTrailerPublicationRequest: {
          type: "object",
          additionalProperties: false,
          required: ["title", "hashtags"],
          description: "Operator-controlled metadata only. The server supplies the provider video, saved episode summary, category, channel, playlist, OAuth credentials, and local source.",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 100, description: "Operator title component. The assembled title with selected hashtags must be at most 100 Unicode characters." },
            hashtags: { type: "array", maxItems: 3, items: { type: "string", pattern: "^#[\\p{L}\\p{N}_-]+$" }, description: "Zero to three selected hashtags; automatic authoring and counts are outside this operation." },
          },
        },
        YoutubeTrailerPublicationResponse: {
          type: "object",
          additionalProperties: false,
          required: ["jobId", "episodeId", "status", "url", "cleanup", "error"],
          description: "Safe publication state. Provider IDs, tokens, OAuth/session values, source fingerprints, raw failures, and filesystem paths are never returned.",
          properties: {
            jobId: { type: "string", format: "uuid" },
            episodeId: { type: "integer", minimum: 1 },
            status: { type: "string", enum: ["not_started", "metadata_accepted", "playlist_confirmed", "public_confirmed", "failed"] },
            url: { type: "string", format: "uri", nullable: true, description: "Canonical YouTube URL only after confirmed public state and playlist membership." },
            cleanup: {
              type: "object",
              additionalProperties: false,
              required: ["status", "error"],
              properties: { status: { type: "string", enum: ["not_started", "complete", "retryable-error"] }, error: { type: "string", nullable: true } },
            },
            error: {
              type: "object",
              additionalProperties: false,
              required: ["category", "occurredAt"],
              properties: { category: { type: "string", nullable: true }, occurredAt: { type: "string", format: "date-time", nullable: true } },
            },
          },
        },
        SuggestedTagRetrieval: {
          type: "object",
          additionalProperties: false,
          required: ["displayTag", "normalizedTag", "approximateCount", "retrievedAt", "cacheStatus", "regionCode", "relevanceLanguage"],
          properties: {
            displayTag: { type: "string", description: "Canonical lower-case hashtag, including one leading #.", example: "#rpg" },
            normalizedTag: { type: "string", description: "Canonical lower-case lookup identity.", example: "#rpg" },
            approximateCount: { type: "integer", minimum: 0, maximum: 1000000, nullable: true, description: "Advisory approximate YouTube search result count, not an exact hashtag inventory; null when unavailable." },
            retrievedAt: { type: "string", format: "date-time", nullable: true },
            cacheStatus: { type: "string", enum: ["hit", "miss"] },
            regionCode: { type: "string", example: "BR" },
            relevanceLanguage: { type: "string", example: "pt" },
          },
        },
        SuggestedTagsSnapshot: {
          type: "object",
          additionalProperties: false,
          required: ["status", "version", "updatedAt", "startedAt", "finishedAt", "retryAt", "errorCategory", "promptVersion", "suggestions"],
          description: "Persisted advisory state grounded in the saved summary. It does not trigger generation when read and exposes at most three suggestions.",
          properties: {
            status: { type: "string", enum: ["idle", "pending", "processing", "done", "unavailable"] },
            version: { type: "integer", minimum: 0 },
            updatedAt: { type: "string", format: "date-time" },
            startedAt: { type: "string", format: "date-time", nullable: true },
            finishedAt: { type: "string", format: "date-time", nullable: true },
            retryAt: { type: "string", format: "date-time", nullable: true },
            errorCategory: { type: "string", nullable: true, enum: ["disabled", "missing_credentials", "unauthorized", "quota_exhausted", "rate_limited", "provider_unavailable", "invalid_provider_response"] },
            promptVersion: { type: "string", nullable: true },
            suggestions: { type: "array", maxItems: 3, items: { allOf: [{ $ref: "#/components/schemas/SuggestedTagRetrieval" }, { type: "object", required: ["relevanceScore"], properties: { relevanceScore: { type: "integer", minimum: 0, maximum: 100 } } }] } },
          },
        },
        HashtagLookupResponse: {
          allOf: [
            { $ref: "#/components/schemas/SuggestedTagRetrieval" },
            {
              type: "object",
              additionalProperties: false,
              required: ["state", "source", "errorCategory", "retryAt"],
              properties: {
                state: { type: "string", enum: ["available", "unavailable"] },
                source: { type: "string", enum: ["youtube-search-list", "cache", "admission", "provider"] },
                errorCategory: { type: "string", nullable: true, enum: ["disabled", "missing_credentials", "unauthorized", "quota_exhausted", "rate_limited", "provider_unavailable", "invalid_provider_response"] },
                retryAt: { type: "string", format: "date-time", nullable: true },
              },
            },
          ],
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
      "/internal/promotions": {
        post: {
          tags: ["Internal Promotion"],
          summary: "Accept one prepared episode promotion",
          description: "Private API-to-bot contract. The API prepares episode identity, title, public URL, canonical trailer digest, destination policy, retry identity, and scheduling eligibility. The bot only performs Telegram side effects and returns per-destination acknowledgement state.",
          security: [{ promotionServiceAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PromotionRequest" },
                examples: {
                  redactionSafe: {
                    value: {
                      contract_version: PROMOTION_CONTRACT_VERSION,
                      source_revision: `${PROMOTION_CONTRACT_SOURCE_REVISION}:${"0".repeat(64)}`,
                      notification_id: "episode:42",
                      episode_id: 42,
                      episode_number: 42,
                      title: "DC 42 - Example episode",
                      public_download_url: "https://example.invalid/episode/42",
                      trailer: { media_reference: "episodes/42/trailer.mp4", sha256: "0".repeat(64), byte_count: 1024, mime_type: "video/mp4" },
                      destinations: ["guild_trailer", "advance_access"],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Per-destination acknowledgement. Unknown effects require reconciliation before retry and never imply blind re-send.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PromotionAcknowledgement" },
                  examples: {
                    redactionSafe: {
                      value: {
                        contract_version: PROMOTION_CONTRACT_VERSION,
                        notification_id: "episode:42",
                        status: "complete",
                        effects: [
                          { destination: "guild_trailer", status: "complete", message_id: "example-message-id", file_id: "example-file-id", acknowledged_at: "2026-01-01T00:00:00.000Z" },
                          { destination: "advance_access", status: "replayed", message_id: "example-topic-message-id", topic_id: "example-topic-id", message_thread_id: "example-thread-id", acknowledged_at: "2026-01-01T00:00:00.000Z" },
                        ],
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "Malformed payload; no Telegram side effect is implied." },
            "401": { description: "Dedicated service authentication missing or invalid; user JWT and AUTH_BYPASS are not accepted." },
            "403": { description: "Service credential lacks the private contract permission." },
            "408": { description: "Bounded request timeout; the effect may be unknown and must be reconciled by stable identity." },
            "422": { description: "Acknowledgement or request semantics rejected safely." },
            "500": { description: "Telegram service failure; API retains durable per-destination retry evidence." },
            "504": { description: "Transport timeout after possible side effect; API marks the effect unknown until reconciliation." },
          },
        },
      },
      "/internal/promotion-media/{episodeId}/trailer-video": {
        get: {
          tags: ["Internal Promotion"],
          summary: "Stream one canonical trailer video to the promotion consumer",
          description: "Private service-authenticated logical media handoff. The route accepts a positive episode ID only, resolves the API-owned canonical artifact, and never accepts or returns a host path or public/static media URL.",
          security: [{ promotionServiceAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: {
            "200": {
              description: "Canonical MP4 trailer bytes.",
              headers: {
                "Cache-Control": { schema: { type: "string", example: "no-store" } },
                "X-Content-Type-Options": { schema: { type: "string", example: "nosniff" } },
                "Content-Type": { schema: { type: "string", example: "video/mp4" } },
                "Content-Length": { schema: { type: "integer", minimum: 1 } },
                "X-Content-SHA256": { schema: { type: "string", pattern: "^[a-f0-9]{64}$" } },
                Digest: { schema: { type: "string", example: "sha-256=base64-digest" } },
              },
              content: { "video/mp4": { schema: { type: "string", format: "binary" } } },
            },
            "400": { description: "Invalid positive episode ID." },
            "401": { description: "Dedicated service authentication missing or invalid; AUTH_BYPASS cannot satisfy this route." },
            "404": { description: "Canonical trailer media is unavailable." },
            "503": { description: "Private promotion media service is not configured." },
          },
        },
      },
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
      "/v1/episodes/drafts": {
        post: {
          tags: ["Episodes"],
          summary: "Reserve a trailer-video draft episode identifier",
          description: "Issues an opaque authenticated reservation for a positive episodeId that is not persisted or already reserved. The reservation is owner-bound and expires after 24 hours.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["episodeId"], properties: { episodeId: { type: "integer", minimum: 1 } } } } },
          },
          responses: {
            "201": { description: "Opaque owner-bound draft reservation." },
            "400": { description: "episodeId must be a positive integer." },
            "401": { description: "Unauthorized." },
            "409": { description: "Episode is persisted or already reserved." },
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
          summary: "Create episode and consume its authenticated trailer-video draft reservation",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { allOf: [{ $ref: "#/components/schemas/Episode" }, { type: "object", required: ["draftId"], properties: { draftId: { type: "string", format: "uuid" } } }] },
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
                    artifacts: { type: "array", minItems: 1, description: "Optional. Omit this property (or the entire JSON body) to select all catalog artifacts. trailer-video includes only server-derived final trailer.mp4; clients never supply paths or filenames.", items: { type: "string", enum: ["episode", "trailer", "trailer-video", "transcript", "image", "image-low"] }, example: ["episode", "trailer-video"] },
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
      "/v1/episodes/{episodeId}/youtube-trailer-jobs": {
        post: {
          tags: ["Episodes"],
          summary: "Start or reuse a private trailer-video transfer job",
          description: "Creates one durable API-owned private-first YouTube job for the current canonical source, including an authenticated staged draft source, or reuses its active job. A private watch URL may be returned before Save; publication is requested separately by the Save-time commit route. Cache-Control is no-store.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 100, description: "Read-only assembled trailer title prefix, normally `Trailer - {episode name}`; hashtag suffixes are supplied separately and the complete Unicode title must be at most 100 code points." }, summary: { type: "string", maxLength: 5000 }, hashtags: { type: "array", maxItems: 3, items: { type: "string", pattern: "^#[\\p{L}\\p{N}_-]+$" } }, draftId: { type: "string", format: "uuid", description: "Authenticated trailer draft reservation when the episode has not been saved yet." } } } } } },
          responses: {
            "200": { description: "An active job for the current finalized source was reused.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } }, Location: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } },
            "202": { description: "A private-first job was queued.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } }, Location: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } },
            "400": { description: "Invalid episodeId or non-empty/unknown request body." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "Final trailer-video source is unavailable." },
          },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/current": {
        get: {
          tags: ["Episodes"], summary: "Get the current finalized-source YouTube trailer job", description: "Authenticated no-store reload/restart recovery lookup for the current canonical trailer source.", security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: { "200": { description: "Safe current-source snapshot.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "No current-source job." } },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/commit": {
        post: {
          tags: ["Episodes"], summary: "Commit Save-time metadata and publication intent", description: "Records durable publication intent after episode Save. If the private job is ready, the API updates the saved summary/title/hashtags and publishes; otherwise the worker completes publication after private readiness.", security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["title", "hashtags"], properties: { jobId: { type: "string", format: "uuid", description: "Optional idempotency/reload hint for the current private job." }, title: { type: "string", minLength: 1, maxLength: 100, description: "Read-only computed title prefix, formatted as `Trailer - {episode name}`; the server validates the complete title plus hashtag suffixes by Unicode code point count." }, hashtags: { type: "array", maxItems: 3, uniqueItems: true, items: { type: "string", pattern: "^#[\\p{L}\\p{N}_-]+$" } } } } } } },
          responses: { "200": { description: "Publication completed or reconciled using the exact submitted title and hashtags." }, "202": { description: "Publication intent recorded; the private job is still transferring or processing." }, "400": { description: "Invalid title/hashtags or assembled Unicode title over 100 code points; no metadata mutation occurs." }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "Episode or current job not found." } },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}": {
        get: {
          tags: ["Episodes"],
          summary: "Poll a private trailer-video transfer job",
          description: "Returns only sanitized durable lifecycle/progress/cancellation state. It never exposes OAuth/session data, provider identifiers or raw failures, source fingerprints, or filesystem paths. Cache-Control is no-store.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }, { name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Opaque job identifier." }],
          responses: { "200": { description: "Safe private-job snapshot.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } }, "400": { description: "Invalid episodeId." }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "`{ message: \"YouTube trailer job not found\" }` for unknown, invalid, or episode-mismatched jobs." } },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/cancel": {
        post: {
          tags: ["Episodes"],
          summary: "Request cancellation of a private trailer-video transfer job",
          description: "Requests durable local cancellation. Before provider acceptance it may stop locally; after accepted bytes or a provider video it reports provider-video-retained and never claims remote rollback or deletion. Cache-Control is no-store.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }, { name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Opaque job identifier." }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false, maxProperties: 0 } } } },
          responses: { "202": { description: "Cancellation was recorded; poll the safe status snapshot for its final boundary.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } }, "400": { description: "Invalid episodeId or non-empty/unknown request body." }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "`{ message: \"YouTube trailer job not found\" }` for unknown, invalid, or episode-mismatched jobs." } },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/retry": {
        post: {
          tags: ["Episodes"], summary: "Retry or reconcile the same YouTube trailer job", description: "Authenticated no-store retry that reuses the same current-source row, resumable session, and accepted provider video evidence.", security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }, { name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false, maxProperties: 0 } } } },
          responses: { "202": { description: "Same durable job requeued or already active.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerJobSnapshot" } } } }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "Unknown, mismatched, obsolete, or non-current job." } },
        },
      },
      "/v1/episodes/{episodeId}/youtube-trailer-jobs/{jobId}/publish": {
        post: {
          tags: ["Episodes"],
          summary: "Publish a ready trailer video",
          description: "Explicit authenticated, no-store publication operation. The API reconciles the server-owned private-ready video, applies the operator title plus selected hashtags and the saved episode summary, confirms playlist insertion while private, then performs the only public transition. Repeated requests reconcile the same provider video. Live publication is disabled by default until the production OAuth/channel readiness checkpoint confirms youtube.upload and youtube.force-ssl, channel UCq-TjauoYJrr3po121gA6iw, and playlist PLlsWY6yTsd_EsW1HlbXZs3Sz72o42376t. Retention keeps the current trailer plus the newest twelve eligible prior local versions by default; cleanup failures remain recoverable and never undo public publication.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." },
            { name: "jobId", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "Opaque server-owned private-job identifier; it must belong to the episode." },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerPublicationRequest" } } } },
          responses: {
            "200": { description: "Safe publication state; URL is present only after confirmed public publication and playlist insertion.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTrailerPublicationResponse" } } } },
            "400": { description: "Invalid positive episodeId or strict title/hashtag metadata; assembled Unicode title exceeds 100 characters." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "Unknown, mismatched, stale, or not-ready episode/job identity." },
            "503": { description: "Live publication is disabled or readiness is unavailable; no provider write is attempted." },
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
      "/v1/episodes/{episodeId}/episodes-generated-summary": {
        get: {
          tags: ["Episodes"],
          summary: "Read generated summary and persisted hashtag suggestions",
          description: "Protected no-store snapshot. Reading never starts or regenerates authoring; suggestions are advisory, grounded in the saved summary, and contain at most three sanitized approximate-count records.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: {
            "200": { description: "Summary status, text when done, and persisted suggested-tags snapshot.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { type: "object", properties: { suggestedTags: { $ref: "#/components/schemas/SuggestedTagsSnapshot" } } } } } },
            "400": { description: "Invalid episodeId." },
            "401": { description: "Missing, invalid, or expired bearer token." },
          },
        },
      },
      "/v1/episodes/{episodeId}/hashtag-lookup": {
        post: {
          tags: ["Episodes"],
          summary: "Look up one hashtag approximate count",
          description: "Protected, no-store manual lookup. The server canonicalizes one strict tag, serves the shared durable cache when fresh, and applies the non-borrowable server-managed manual quota/rate allocation. Counts are approximate and advisory; allocation ledger values, OAuth credentials, prompts, transcript/summary text, raw provider responses, and provider URLs are never exposed. A browser may debounce this request for two seconds, but debounce is not an API control.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["tag"], properties: { tag: { type: "string", minLength: 1, maxLength: 100, pattern: "^#?[^\\s#]+$", description: "One hashtag with an optional leading #; Unicode normalization and lower-case canonicalization are server-owned." } } } } },
          },
          responses: {
            "200": { description: "Available approximate count and retrieval metadata, from cache or provider.", headers: { "Cache-Control": { schema: { type: "string", example: "no-store" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/HashtagLookupResponse" } } } },
            "400": { description: "Invalid episodeId or strict one-tag JSON body." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "429": { description: "Manual server-managed admission is exhausted; response is a safe unavailable DTO with retryAt." },
            "503": { description: "Provider/configuration failure; response is a safe unavailable DTO with errorCategory and retryAt." },
          },
        },
      },
      "/v1/episodes/{episodeId}/transcription/whisper": {
        post: {
          tags: ["Episodes"],
          summary: "Retry episode transcription with faster-whisper",
          description: "Queues the available staged or finalized episode audio with the server-configured faster-whisper worker. This endpoint is intended as an explicit fallback after a Gemini transcription failure; provider credentials and filesystem paths remain server-owned.",
          security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: {
            "200": { description: "faster-whisper transcription queued or already processing." },
            "400": { description: "Invalid episodeId." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "404": { description: "Episode audio is not available." },
          },
        },
      },
      "/v1/episodes/{episodeId}/audio": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode audio file",
          description: "The server probes the uploaded MP3 and returns a successful response only with backend-confirmed duration (HH:MM:SS) and nonnegative integer bytes. Probe failure rejects the upload and removes staged output; browser-supplied metadata is ignored.",
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
          responses: { "200": { description: "Audio staged with backend-confirmed duration and bytes, plus transcription status." }, "400": { description: "Invalid file, missing/unusable server-side metadata, or failed metadata confirmation." }, "401": { description: "Unauthorized" }, "404": { description: "Not found" } },
        },
      },
      "/v1/episodes/{episodeId}/trailer": {
        post: {
          tags: ["Episodes"],
          summary: "Upload episode trailer file",
          description: "Trailer-audio upload preserves the existing filename/message response contract and does not require episode-audio duration or byte metadata.",
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
      "/v1/episodes/{episodeId}/trailer-video": {
        post: {
          tags: ["Episodes"],
          summary: "Upload or replace the final trailer video",
          description: "Authenticated administrators upload one MP4 through multipart field file, subject to the default 524288000-byte server limit; the operation never accepts client paths. New drafts remain staged until Save, while persisted replacements are promoted atomically. A staged upload can begin a private YouTube job; replacement cleanup deletes superseded provider videos through the server-owned provider boundary.",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Positive episode identifier." },
            { name: "X-Episode-Draft-Id", in: "header", required: false, schema: { type: "string", format: "uuid" }, description: "Required for a not-yet-persisted episode; issued by POST /v1/episodes/drafts." },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary", description: "MP4 final trailer-video file only." },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Response with explicit staged or finalized lifecycle state and canonical trailerVideoFileName only when finalized." },
            "400": { description: "Invalid episodeId, missing file, non-MP4 upload, or upload above the configured server limit." },
            "401": { description: "Missing, invalid, or expired bearer token." },
            "403": { description: "Draft reservation belongs to another user or episode." },
            "404": { description: "Episode not found." },
            "409": { description: "Missing, expired, reused, or unreserved draft reservation." },
          },
        },
        delete: {
          tags: ["Episodes"], summary: "Delete the local trailer and associated YouTube videos", description: "Cancels active work, removes the local trailer, and idempotently deletes associated provider videos. Temporary provider failures are recorded as retryable cleanup reconciliation.", security: [{ bearerAuth: [] }],
          parameters: [{ name: "episodeId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: { "200": { description: "Trailer and cleanup targets removed." }, "401": { description: "Missing, invalid, or expired bearer token." }, "404": { description: "Episode not found." } },
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

type OpenApiSchema = {
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  enum?: string[];
  items?: OpenApiSchema;
};

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, { scheme?: string }>;
  };
  paths?: Record<string, {
    post?: { responses?: Record<string, unknown>; security?: Array<Record<string, unknown>> };
    get?: { responses?: Record<string, unknown>; security?: Array<Record<string, unknown>> };
  }>;
};

export const getPromotionOpenApiProjection = (spec: unknown = swaggerSpec): PromotionContractProjection => {
  const document = spec as OpenApiDocument;
  const schemas = document.components?.schemas ?? {};
  const requestSchema = schemas.PromotionRequest;
  const acknowledgementSchema = schemas.PromotionAcknowledgement;
  const destinationAcknowledgementSchema = schemas.PromotionDestinationAcknowledgement;
  const errorSchema = schemas.PromotionError;
  const requestPath = document.paths?.["/internal/promotions"]?.post;
  const mediaPath = document.paths?.["/internal/promotion-media/{episodeId}/trailer-video"]?.get;
  const serviceAuth = document.components?.securitySchemes?.promotionServiceAuth;
  if (!requestSchema || !acknowledgementSchema || !destinationAcknowledgementSchema || !errorSchema || !requestPath || !mediaPath || !serviceAuth) {
    throw new Error("Promotion OpenAPI projection is incomplete.");
  }

  const base = getPromotionContractProjection();
  const requestDestinations = (requestSchema.properties?.destinations?.items?.enum ?? []) as PromotionContractProjection["request"]["destinationKeys"];
  const acknowledgementStatuses = (acknowledgementSchema.properties?.status?.enum ?? []) as PromotionContractProjection["acknowledgement"]["statusValues"];
  const errorCategories = (errorSchema.properties?.category?.enum ?? []) as PromotionContractProjection["acknowledgement"]["errorCategories"];
  const mediaResponseHeaders = ["cache-control", "x-content-type-options", "content-type", "content-length", "x-content-sha256", "digest"] as PromotionContractProjection["media"]["responseHeaders"];
  const documentedResponseStatuses = Object.keys(requestPath.responses ?? {});
  if (!documentedResponseStatuses.includes("408") || !documentedResponseStatuses.includes("504")) {
    throw new Error("Promotion OpenAPI projection is missing bounded timeout responses.");
  }
  if (serviceAuth.scheme !== base.authentication.scheme) {
    throw new Error("Promotion OpenAPI projection has the wrong authentication scheme.");
  }

  return {
    ...base,
    request: {
      ...base.request,
      method: "POST",
      path: "/internal/promotions",
      requiredFields: [...(requestSchema.required ?? [])],
      destinationKeys: [...requestDestinations],
      effectKeys: [...(Object.keys(destinationAcknowledgementSchema.properties ?? {}))],
    },
    acknowledgement: {
      ...base.acknowledgement,
      statusValues: [...acknowledgementStatuses],
      effectKeys: [...(Object.keys(destinationAcknowledgementSchema.properties ?? {}))],
      errorCategories: [...errorCategories],
    },
    media: {
      ...base.media,
      method: "GET",
      path: "/internal/promotion-media/{episodeId}/trailer-video",
      responseHeaders: mediaResponseHeaders,
    },
  };
};
