export type NavigationAxis = 'panel' | 'page';

export function clampProgress(value: number) {
  'worklet';
  return Math.max(0, Math.min(1, value));
}

/** Project 150ms ahead so short flicks finish without making slow drags commit early. */
export function projectedDestination(progress: number, velocity: number, distance: number): 0 | 1 {
  'worklet';
  return clampProgress(progress + velocity * 0.15 / Math.max(1, distance)) > 0.5 ? 1 : 0;
}

export function navigationAxis(panel: number, panelTarget: number, page: number, pageTarget: number, dx: number): NavigationAxis {
  'worklet';
  if (panel > 0.001 || panelTarget === 1) return 'panel';
  if (page > 0.001 || pageTarget === 1) return 'page';
  return dx > 0 ? 'panel' : 'page';
}
