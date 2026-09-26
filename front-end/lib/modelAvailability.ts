// Model availability gate for Practice / Assessment.
//
// Only level categories with a deployable sign-recognition model behind
// /api/predict may be opened in practice or assessment. Chapters in other
// categories stay locked with an "AI model coming soon" state, while their
// lessons (video-only) remain fully accessible.
//
// To ungate a future model: add its `levels.category` slug to
// MODEL_BACKED_CATEGORIES. To re-gate: remove it. One-line change.

// Canonical slugs — see the category dropdown in
// app/admin/(protected)/levels/page.tsx.
export const MODEL_BACKED_CATEGORIES: ReadonlySet<string> = new Set([
  'greetings',
  'five_ws', // weight file is model/5whs.pth (name drift — loader maps five_ws → 5whs.pth)
  'alphabets', // verified on juansign-model-vol:model/alphabets.pth (2026-09-26)
  'days_of_week',
]);

// Categories known to exist but currently without a valid model.
export const GATED_CATEGORIES: ReadonlySet<string> = new Set([
  'conversational_phrases',
  'numbers',
  'adjectives_verbs',
  'family',
]);

// Unknown / null categories fail closed (treated as no-model).
export function hasModelForCategory(category: string | null | undefined): boolean {
  return !!category && MODEL_BACKED_CATEGORIES.has(category);
}
