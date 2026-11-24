/** Games own their catalog and future rules. They do not depend on achievement definitions. */
export const guildGameCatalog = [
  { key: "palavra", title: "Palavra", cadence: "daily", playable: false },
  { key: "desafio", title: "Desafio", cadence: "daily", playable: false },
  { key: "trivia", title: "Trivia", cadence: "daily", playable: false },
  { key: "quem-disse", title: "Quem disse", cadence: "daily", playable: false },
] as const;
