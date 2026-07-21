import { Linking, Platform, Share } from 'react-native';
import { showAlert } from './alert';
import { money } from '../theme';

export function referralMessage(code: string, rewardCents: number): string {
  return `Join me on Penny Pinching Trivia! Use my code ${code} and we both earn ${money(rewardCents)} in tokens once you play. 🧠💸`;
}

async function openOrFallback(url: string, message: string, label: string) {
  try {
    if (Platform.OS !== 'web') {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('unsupported');
    }
    await Linking.openURL(url);
    return;
  } catch {
    // fall through to the clipboard/no-app messaging below
  }
  if (Platform.OS === 'web') {
    try {
      await navigator.clipboard?.writeText(message);
      showAlert('Copied!', `We couldn't open ${label} automatically from the browser, so we copied the invite message - paste it in.`);
    } catch {
      showAlert('Copy failed', message);
    }
  } else {
    showAlert('Could not open', `No ${label} app was found on this device.`);
  }
}

export async function inviteViaEmail(code: string, rewardCents: number) {
  const message = referralMessage(code, rewardCents);
  const url = `mailto:?subject=${encodeURIComponent('Join me on Penny Pinching Trivia!')}&body=${encodeURIComponent(message)}`;
  await openOrFallback(url, message, 'email');
}

export async function inviteViaSms(code: string, rewardCents: number) {
  const message = referralMessage(code, rewardCents);
  // iOS wants `sms:&body=`, Android wants `sms:?body=` - the wrong separator
  // silently fails to prefill (or fails to open) on the other platform.
  const url = Platform.OS === 'ios' ? `sms:&body=${encodeURIComponent(message)}` : `sms:?body=${encodeURIComponent(message)}`;
  await openOrFallback(url, message, 'messaging');
}

export async function inviteViaMore(code: string, rewardCents: number) {
  const message = referralMessage(code, rewardCents);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(message);
      showAlert('Copied!', 'Your invite message is on your clipboard - paste it anywhere.');
    } else {
      await Share.share({ message });
    }
  } catch {
    // user cancelled the share sheet - nothing to do
  }
}
