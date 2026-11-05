/**
 * Admin notification chime (public/sounds/notifications/admin-notif.mp3).
 * Browsers block sound until the admin has clicked something on the page, so
 * the first alert after a fresh load can be silent — that's expected.
 */
const NOTIF_SOUND = "/sounds/notifications/admin-notif.mp3";
let audio: HTMLAudioElement | null = null;
let lastPlayed = 0;

export function playNotifSound() {
  // Several alerts landing together (bell + message) chime once
  if (Date.now() - lastPlayed < 1500) return;
  lastPlayed = Date.now();
  try {
    audio ??= new Audio(NOTIF_SOUND);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch { /* no audio support */ }
}
