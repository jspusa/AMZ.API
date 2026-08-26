export type NSpellDictionary = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

export default function createNSpell(
  affix: string | Uint8Array,
  dictionary: string | Uint8Array,
): NSpellDictionary;
