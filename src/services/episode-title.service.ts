const canonicalTitleSuffix = (episodeNumber: number): string => `DC ${episodeNumber}`;

export const buildCanonicalEpisodeTitle = (input: {
  title: string;
  episodeNumber?: number;
  episodeType?: string;
}): string => {
  const rawEpisodeType = input.episodeType?.trim() ?? "";
  const episodeType = rawEpisodeType.toLocaleLowerCase() === "leitura de pergaminhos"
    ? "Leitura de pergaminhos"
    : rawEpisodeType;
  const episodeNumber = input.episodeNumber;
  const titleWithoutNumber = input.title.trim().replace(/\s*\|\s*DC\s+\d+\s*$/iu, "");
  const typePrefix = episodeType && episodeType.toLocaleLowerCase() !== "nenhum"
    ? new RegExp(`^${episodeType.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*-\\s*`, "iu")
    : null;
  const title = (typePrefix ? titleWithoutNumber.replace(typePrefix, "") : titleWithoutNumber).trim();
  const withType = episodeType && episodeType.toLocaleLowerCase() !== "nenhum"
    ? `${episodeType} - ${title}`
    : title;
  return Number.isInteger(episodeNumber) && episodeNumber! > 0
    ? `${withType} | ${canonicalTitleSuffix(episodeNumber!)}`
    : withType;
};
