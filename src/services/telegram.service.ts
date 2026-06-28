import { config } from "../config/env";
import type { EpisodeRow } from "../repositories/episode.repository";

const requiredTelegramConfig = (): { botToken: string; chatId: string; apiBaseUrl: string } => {
  if (!config.telegram.botToken) {
    throw new Error("Missing required env var: TELEGRAM_BOT_TOKEN");
  }
  if (!config.telegram.chatId) {
    throw new Error("Missing required env var: TELEGRAM_CHAT_ID");
  }

  return config.telegram;
};

const escapeMarkdownV2 = (value: string): string => {
  return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
};

const buildEpisodeMessage = (episode: EpisodeRow): string => {
  const title = escapeMarkdownV2(episode.title);
  const summary = escapeMarkdownV2(episode.summary || "");
  const pubDate = escapeMarkdownV2(new Date(episode.pubDate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }));
  const link = `https://dragaocareca.com/#/episode/${episode.episodeId}`;

  return [
    `Novo episódio lançado`,
    `*${title}*`,
    summary ? summary : null,
    `Publicação: ${pubDate}`,
    `[Abrir no site](${link})`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

export const sendLaunchTelegramNotification = async (episode: EpisodeRow): Promise<void> => {
  const { botToken, chatId, apiBaseUrl } = requiredTelegramConfig();
  const message = buildEpisodeMessage(episode);
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Telegram notification failed (${response.status}): ${details || response.statusText}`);
  }
};
