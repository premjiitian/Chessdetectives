import type { Settings } from './develop';
import { clampSettings } from './develop';

/** Looks are small, explainable changes on top of the auto edit. */
export interface Look { id: string; name: string; hint: string; tweak: Partial<Settings>; set?: Partial<Settings> }

export const LOOKS: Look[] = [
  { id: 'natural', name: 'Natural', hint: 'Balanced and true to life', tweak: {} },
  { id: 'vivid', name: 'Vivid', hint: 'Punchier colour and contrast', tweak: { vibrance: 20, contrast: 12, clarity: 10 } },
  { id: 'portrait', name: 'Portrait', hint: 'Soft skin, bright faces', tweak: { clarity: -15, shadows: 10, vibrance: -5, sharpening: -10 } },
  { id: 'landscape', name: 'Landscape', hint: 'Deeper skies, crisp detail', tweak: { highlights: -15, blacks: -8, clarity: 20, vibrance: 25 } },
  { id: 'warm', name: 'Golden', hint: 'Warm, late-afternoon glow', tweak: { temp: 18, vibrance: 8 } },
  { id: 'mono', name: 'B&W', hint: 'Classic black and white', tweak: { contrast: 15, clarity: 10 }, set: { saturation: -100, vibrance: 0 } },
];

export function applyLook(base: Settings, look: Look): Settings {
  const out = { ...base };
  for (const [k, v] of Object.entries(look.tweak) as [keyof Settings, number][]) out[k] += v;
  if (look.set) Object.assign(out, look.set);
  return clampSettings(out);
}
