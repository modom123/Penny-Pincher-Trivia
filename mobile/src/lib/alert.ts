import { Alert, Platform } from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

// react-native-web's Alert.alert is a hard no-op (react-native-web's Alert
// export is literally `static alert() {}`), so every error/confirmation
// message in this app was being silently swallowed on web and desktop -
// the button "did nothing" because the failure was real, just invisible.
// Falls back to window.alert/confirm on web; unchanged native behavior
// everywhere else.
export function showAlert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }
  const cancelButton = buttons.find((b) => b.style === 'cancel');
  const actionButton = buttons.find((b) => b !== cancelButton) ?? buttons[buttons.length - 1];
  if (window.confirm(text)) {
    actionButton?.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}
