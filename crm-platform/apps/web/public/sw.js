/*
 * The CRM service worker: browser notifications (Web Push) while the CRM tab is closed. It does nothing else: no caching, no offline
 * pages, no fetch handler, so it can never serve a stale app or sit between a person and the API.
 *
 * It is plain JavaScript on purpose (no build step, served as-is from /sw.js with the whole site as its scope).
 *
 * Push payload (JSON, produced by the API, see packages/contracts web-push.ts):
 *   { v: 1, title, body, tag, url, silent, notificationId, test }
 * The payload is untrusted input to this script: every field is type-checked and cut to length before use, and the link is only ever
 * opened when it points at this same origin.
 */

var ICON = '/notification-icon.png';
var BADGE = '/notification-badge.png';

self.addEventListener('install', function () {
  // A new version takes over at once: there is no page state in this worker to protect.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function text(value, max, fallback) {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : fallback;
}

/** A same-origin URL for a link from a payload, or the home page for anything else (another origin, javascript:, garbage). */
function safeTarget(link) {
  try {
    var url = new URL(typeof link === 'string' ? link : '/', self.location.origin);
    if (url.origin !== self.location.origin) return new URL('/', self.location.origin).href;
    return url.href;
  } catch (e) {
    return new URL('/', self.location.origin).href;
  }
}

function parse(event) {
  try {
    var data = event.data ? event.data.json() : null;
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

self.addEventListener('push', function (event) {
  var payload = parse(event);
  var isTest = payload.test === true;

  event.waitUntil(
    windowClients().then(function (clients) {
      // The one case a browser lets a push show nothing: the person is looking at the app, whose bell and toast already say it. The
      // server skips such a push too; this covers the moment between its check and the delivery.
      var looking = clients.some(function (c) {
        return c.visibilityState === 'visible';
      });
      if (looking && !isTest) return undefined;

      var tag = text(payload.tag, 120, '');
      var options = {
        body: text(payload.body, 100, ''),
        icon: ICON,
        badge: BADGE,
        dir: 'auto',
        data: {
          url: safeTarget(payload.url),
          notificationId: text(payload.notificationId, 64, ''),
        },
      };
      if (tag) {
        options.tag = tag;
        // A later message in the same conversation replaces the earlier one and alerts again, unless it is a quiet update.
        options.renotify = payload.silent !== true;
      }
      if (payload.silent === true) options.silent = true;
      return self.registration.showNotification(
        text(payload.title, 100, 'New notification'),
        options,
      );
    }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = safeTarget(event.notification.data && event.notification.data.url);

  event.waitUntil(
    windowClients().then(function (clients) {
      var mine = clients.filter(function (c) {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch (e) {
          return false;
        }
      });
      // Prefer the tab already in front, then any tab of the CRM; open a new one only when there is none.
      var best =
        mine.find(function (c) {
          return c.focused;
        }) ||
        mine.find(function (c) {
          return c.visibilityState === 'visible';
        }) ||
        mine[0];
      if (!best) return self.clients.openWindow(target);
      return best
        .focus()
        .then(function (focused) {
          var client = focused || best;
          // `navigate` only works for a tab this worker controls; for any other the page is asked to move itself (it listens for this).
          return client.navigate(target).catch(function () {
            client.postMessage({ type: 'crm-push-open', url: target });
          });
        })
        .catch(function () {
          return self.clients.openWindow(target);
        });
    }),
  );
});

// The browser dropped or rotated the subscription. The worker cannot sign in again to tell the server, so it asks any open tab to
// re-register; with none open, the next visit does it (the app re-syncs a device it knows is enabled when it loads).
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    windowClients().then(function (clients) {
      clients.forEach(function (c) {
        c.postMessage({ type: 'crm-push-resubscribe' });
      });
    }),
  );
});
