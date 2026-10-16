import { createContext, useContext, useMemo } from 'react';
import { View, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export const NavigationGestureContext = createContext<ReturnType<typeof Gesture.Pan> | null>(null);

/** Wait for controls to finish their touch sequence before allowing page swipes. */
export function NavigationGestureBoundary({ children, ...props }: ViewProps) {
  const navigation = useContext(NavigationGestureContext);
  const native = useMemo(() => {
    // Immediate activation on a wrapper View cancels React Native Pressable touches.
    // A passive native recognizer still blocks the page pan while controls handle taps.
    const gesture = Gesture.Native();
    return navigation ? gesture.blocksExternalGesture(navigation) : gesture;
  }, [navigation]);
  return <GestureDetector gesture={native}><View {...props} collapsable={false}>{children}</View></GestureDetector>;
}
