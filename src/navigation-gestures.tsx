import { createContext, useContext, type MutableRefObject } from 'react';
import { View, type ViewProps } from 'react-native';

export const NavigationGestureContext = createContext<MutableRefObject<boolean> | null>(null);

/** Excludes text editing and interactive controls from horizontal page gestures. */
export function NavigationGestureBoundary({ children, onTouchStart, ...props }: ViewProps) {
  const excluded = useContext(NavigationGestureContext);
  return <View {...props} onTouchStart={event => {
    if (excluded) excluded.current = true;
    onTouchStart?.(event);
  }}>{children}</View>;
}

export function swipeDestination(dx: number, dy: number, drawerOpen: boolean, suggestions: boolean) {
  if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return null;
  if (drawerOpen) return dx < 0 ? 'close' : null;
  if (suggestions) return dx > 0 ? 'home' : null;
  return dx < 0 ? 'suggestions' : 'accounts';
}
