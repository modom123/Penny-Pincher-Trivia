import { Linking, Platform, Share } from 'react-native';
import { showAlert } from './alert';
import { money } from '../theme';

// The live player web app (see website/index.html's PPT_CONFIG.appUrl - keep
// these in sync; there's no shared config between the two projects yet).
// ?ref= is read by UsernamePickerScreen and prefills the referral code field
// so a tapped link actually gets a new player to the "where do I enter this"
// step instead of just handing them a code with nowhere to put it.
const APP_URL = 'https://playerapp-alpha.vercel.app';

export function referralLink(code: string): string {
  return `${APP_URL}/?ref=${code}`;
}

export function referralMessage(code: string, rewardCents: number): string {
  return `Join me on Penny Pinching Trivia! Use my code ${code} and we both earn ${money(rewardCents)} in tokens once you play. Sign up here: ${referralLink(code)} 🧠💸`;
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

// Copies just the bare link, not the full pitch message. A wall of
// promotional text with a link buried at the end often doesn't get
// auto-linkified (or generate a link preview) when pasted into a DM/story/
// bio on some platforms, which makes it read as spam rather than a tappable
// invite - this gives people a clean link to paste wherever that matters.
export async function copyReferralLink(code: string) {
  const link = referralLink(code);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(link);
    } else {
      await Share.share({ message: link });
      return;
    }
    showAlert('Link copied!', 'Paste it anywhere - your bio, a story, a DM.');
  } catch {
    showAlert('Copy failed', link);
  }
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
