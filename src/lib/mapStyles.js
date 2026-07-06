// Map "designs" for the free Google embed. The embed iframe is cross-origin, so
// Google's native cloud/JSON map styles can't be applied — these are tuned CSS
// filters that recolor the whole map to a distinct look. Approximations, not
// Google's own styled tiles (that would need a keyed Maps JS API).
//
// ONE source of truth: the admin picker, the public maps, and the preview
// swatches all read `filter` from here. "standard" = no filter.
export const MAP_STYLES = [
  { key: "standard", label: "Standard", filter: "", blurb: "The normal Google map." },
  { key: "night",    label: "Night",    filter: "invert(0.92) hue-rotate(180deg) brightness(0.95) contrast(0.9)", blurb: "Dark, night-time look." },
  { key: "silver",   label: "Silver",   filter: "grayscale(1) contrast(0.95) brightness(1.04)", blurb: "Muted greyscale, minimal." },
  { key: "retro",    label: "Retro",    filter: "sepia(0.55) saturate(1.35) hue-rotate(-12deg) brightness(1.02)", blurb: "Warm vintage paper." },
  { key: "dusk",     label: "Dusk",     filter: "saturate(0.6) hue-rotate(6deg) brightness(0.97) contrast(1.03)", blurb: "Soft, desaturated cool." },
];

// Resolve the active filter from a client's settings. Back-compat: an older
// client with mapNight=true (before the picker) still reads as "night".
export function mapStyleKey(settings) {
  const s = settings || {};
  if (s.mapStyle && MAP_STYLES.some((m) => m.key === s.mapStyle)) return s.mapStyle;
  if (s.mapNight === true) return "night";
  return "standard";
}
export function mapStyleFilter(settings) {
  const k = mapStyleKey(settings);
  return (MAP_STYLES.find((m) => m.key === k) || MAP_STYLES[0]).filter;
}
