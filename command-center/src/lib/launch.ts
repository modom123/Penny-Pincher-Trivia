// Fixed go-live target. Everyone sees the same countdown regardless of when
// they load the page. 2026-07-16T08:03:34Z (73h from when the countdown started).
export const LAUNCH_TARGET_MS = 1784189014000;
export const LAUNCH_WINDOW_MS = 73 * 3600 * 1000;
export const LAUNCH_START_MS = LAUNCH_TARGET_MS - LAUNCH_WINDOW_MS;
