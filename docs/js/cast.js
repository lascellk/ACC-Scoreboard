// Starts the TV page on a Cast device. Once started it fetches scores itself, so nothing
// here sends data and the phone can leave. Needs Chrome on Android or a computer.
import { CAST_APP_ID } from './config.js';

export function setupCast(slot) {
  if (!CAST_APP_ID || !slot) return;
  window.__onGCastApiAvailable = (available) => {
    if (!available) return;
    cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: CAST_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    slot.hidden = false;
  };
  const script = document.createElement('script');
  script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  document.head.append(script);
}
