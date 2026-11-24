const pageParameters = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 } },
];
const item = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties });
const text = { type: "string", nullable: true };
const publicAchievement = item({ id: text, name: text, description: text, category: text, rarity: text, scope: text, game_key: text, image_url: text, badge_image_url: text });
const response = (schema: unknown) => ({ description: "Successful read", content: { "application/json": { schema } } });
const page = (properties: Record<string, unknown>) => item({ items: { type: "array", items: item(properties) }, limit: { type: "integer" }, offset: { type: "integer" } });
const read = (summary: string, schema: unknown, admin = false, paginated = true) => ({ get: {
  tags: ["Guild foundation"], summary,
  description: "Schema-only foundation: no member login, gameplay, reward grants or import is activated. Query parameters outside the documented pagination are rejected.",
  security: admin ? [{ bearerAuth: [] }] : [],
  ...(paginated ? { parameters: pageParameters } : {}),
  responses: { "200": response(schema), "400": { description: "Invalid pagination" },
    ...(admin ? { "401": { description: "Podcast administrator authentication required" } } : {}),
    "503": { description: "Explicit Guild migration missing or incompatible" } },
} });
export const guildOpenApiPaths = {
  "/v1/guild/public/achievements": read("List active Guild achievements",item({ items: { type: "array", items: publicAchievement }, limit: {type:"integer"}, offset:{type:"integer"} })),
  "/v1/guild/public/members": read("List active public Guild members",page({id:text,display_name:text,slug:text,character_name:text})),
  "/v1/guild/public/films": read("List film catalog",page({id:text,slug:text,title:text,year:{type:"number"},synopsis:text,poster_url:text,runtime:{type:"number",nullable:true}})),
  "/v1/guild/public/games": read("List game definitions; gameplay is not implemented",item({ items:{type:"array",items:item({key:text,title:text,cadence:text,playable:{type:"boolean",enum:[false]}})},gameplayAvailable:{type:"boolean",enum:[false]} }),false,false),
  "/v1/guild/admin/schema": read("Inspect Guild schema version and row counts",item({version:text,tables:{type:"array",items:item({name:text,rows:{type:"integer"}})},capabilities:item({memberAuthentication:{type:"boolean"},gameplay:{type:"boolean"},rewards:{type:"boolean"},imports:{type:"boolean"}})}),true,false),
  "/v1/guild/admin/games/plays": read("List game plays independently of achievements",page({id:text,member_id:text,game:text,day:text,finished:{type:"integer",nullable:true},xp:{type:"integer",nullable:true},version:{type:"integer"}}),true),
  "/v1/guild/admin/achievements/awards": read("List awarded Guild achievements",page({id:text,member_id:text,achievement_id:text,awarded_at:text,awarded_by:text}),true),
  "/v1/guild/admin/progression/ledger": read("List XP credits and reversals by source domain",page({id:text,member_id:text,event_key:text,source_domain:text,source_type:text,source_id:text,delta_xp:{type:"integer"},reversal_of:text,created_at:text}),true),
};
