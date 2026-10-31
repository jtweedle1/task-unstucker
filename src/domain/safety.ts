// Flags tasks where skipping steps could hurt: health, safety, money, legal deadlines.
// Used to warn in Good Enough Mode. A heuristic, not a guarantee, and the copy says so.

const SAFETY_WORDS = [
  'medication',
  'medicine',
  'meds',
  'pill',
  'pills',
  'prescription',
  'insulin',
  'dose',
  'doctor',
  'electric',
  'electrical',
  'wiring',

  'gas leak',
  'smoke alarm',
  'carbon monoxide',
  'ladder',
  'car seat',
  'brakes',
  'court',
  'legal',
  'lawyer',
  'visa',
  'immigration',
  'tax',
  'taxes',
  'deadline',
  'bill',
  'bills',
  'rent',
  'mortgage',
  'eviction',
  'insurance',
  'benefits',
  'loan',
];

const PATTERN = new RegExp(
  `\\b(${SAFETY_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`,
  'i',
);

export function looksSafetyCritical(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => !!t && PATTERN.test(t));
}

export const SAFETY_GOOD_ENOUGH_NOTE =
  'This looks like it might involve health, safety, money, or a deadline. Check the steps before skipping any.';
