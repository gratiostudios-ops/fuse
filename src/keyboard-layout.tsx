import { createContext, useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export const KeyboardVisibilityContext = createContext(false);

/** Native keyboard avoidance is handled by the outer avoiding view. */
export function useKeyboardLayout() {
  const [visible, setVisible] = useState(() => Platform.OS !== 'web' && Keyboard.isVisible());
  const [webHeight, setWebHeight] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = window.visualViewport;
      if (!viewport) return;
      const update = () => {
        const editing = document.activeElement?.matches('input, textarea, [contenteditable="true"]') ?? false;
        const open = editing && window.innerHeight - viewport.height > 100;
        setVisible(open);
        setWebHeight(open ? viewport.height : null);
      };
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      document.addEventListener('focusin', update);
      document.addEventListener('focusout', update);
      return () => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        document.removeEventListener('focusin', update);
        document.removeEventListener('focusout', update);
      };
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => {
      Keyboard.scheduleLayoutAnimation(event);
      setVisible(true);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', event => {
      Keyboard.scheduleLayoutAnimation(event);
      setVisible(false);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return { visible, webHeight };
}
