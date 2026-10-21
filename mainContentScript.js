// mainContentScript.js – MAIN world, document_start

// Determine synchronously whether the filter is currently paused.
// The background script mirrors the pause end time into localStorage so
// this check works before any extension messaging is available.
const checkBlockStatus = () => {
  try {
    const unblockUntil = parseInt(localStorage.getItem('mte_unblock_until'), 10) || 0;
    return !(Date.now() < unblockUntil);
  } catch (error) {
    return true; // Fail closed: treat as internal traffic
  }
};
const shouldBlock = checkBlockStatus();

// Inject inline script directly into page
const injectInlineScript = () => {
  try {
    const inlineScript = document.createElement('script');
    inlineScript.textContent = `
      /* mte-filter */
(function() {
  try {
    const unblockUntil = parseInt(localStorage.getItem('mte_unblock_until'), 10) || 0;
    const now = Date.now();

    if (!(now < unblockUntil)) {
      window['isManagedInternalTraffic'] = true;
    }

    window.mteInjected = true;
    window.mteInjectionTime = now;

  } catch (e) {
    window['isManagedInternalTraffic'] = true;
    window.mteInjected = true;
    window.mteInjectionTime = Date.now();
  }
})();
    `;

    const target = document.head || document.documentElement || document.body || document;

    if (document.head?.firstChild) {
      document.head.insertBefore(inlineScript, document.head.firstChild);
    } else {
      target.prepend(inlineScript);
    }

  } catch (error) {
    window.isManagedInternalTraffic = true;
  }
};

// Monitor and maintain first position
const maintainFirstPosition = () => {
  try {
    if (document.head) {
      const scripts = Array.from(document.head.children).filter(el => el.tagName === 'SCRIPT');
      const ourScript = scripts.find(s => s.textContent && s.textContent.includes('mte-filter'));

      // If we found our script and it's not first, move it to first
      if (ourScript && ourScript !== document.head.firstElementChild) {
        const firstElement = document.head.firstElementChild;
        if (firstElement && firstElement.tagName === 'SCRIPT') {
          document.head.insertBefore(ourScript, firstElement);
        }
      }

      // If we don't have our script injected yet, do it now
      if (!ourScript && scripts.length > 0) {
        injectInlineScript();
      }
    }
  } catch (error) {
    window.isManagedInternalTraffic = true;
  }
};

// Run immediately and monitor for changes
maintainFirstPosition();

// Monitor DOM changes to maintain first position
if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => {
    maintainFirstPosition();
  });

  if (document.head) {
    observer.observe(document.head, { childList: true });
  } else if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
}

// Also set flag directly as backup (this runs in MAIN world)
if (shouldBlock) {
  window.isManagedInternalTraffic = true;
}

const interceptScriptCreation = (shouldBlock) => {
  if (!shouldBlock) { return; }

  try {
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(this, tagName);

      if (tagName.toLowerCase() === 'script') {
        if (typeof window.isManagedInternalTraffic === 'undefined') {
          window.isManagedInternalTraffic = true;
        }
      }

      return element;
    };
  } catch (error) {
    // Silent fallback
  }
};

// Execute interception
interceptScriptCreation(shouldBlock);

// Continuous flag monitoring with unblock respect
const ensureFlagPersistence = () => {
  const checkAndRestoreFlag = async () => {
    try {
      const storageData = await getStorageData();
      const { unblockUntil = 0 } = storageData;
      const now = Date.now();
      const isUnblocked = now < unblockUntil;

      if (!isUnblocked && (typeof window.isManagedInternalTraffic === 'undefined' || window.isManagedInternalTraffic !== true)) {
        window.isManagedInternalTraffic = true;
      } else if (isUnblocked && window.isManagedInternalTraffic === true) {
        delete window.isManagedInternalTraffic;
      }

    } catch (error) {
      // Storage unavailable: fall back to the synchronous localStorage check
      if (shouldBlock && typeof window.isManagedInternalTraffic === 'undefined') {
        window.isManagedInternalTraffic = true;
      }
    }
  };

  checkAndRestoreFlag();
  setInterval(checkAndRestoreFlag, 5000);
};

ensureFlagPersistence();

// Communication with ISOLATED world
let isolatedWorldReady = false;
let requestId = 0;
const pendingRequests = new Map();

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) {
    return;
  }

  if (!event.data || event.data.source !== 'MTE_ISOLATED') {
    return;
  }

  if (event.data.type === 'ready') {
    isolatedWorldReady = true;
    initializeWithStorage();
    return;
  }

  if (event.data.type === 'storageDataResponse') {
    const { requestId: responseId, success, data, error } = event.data;
    const resolver = pendingRequests.get(responseId);

    if (resolver) {
      pendingRequests.delete(responseId);
      if (success) {
        resolver.resolve(data);
      } else {
        resolver.reject(new Error(error || 'Storage access failed'));
      }
    }
  }
});

const getStorageData = () => {
  return new Promise((resolve, reject) => {
    if (!isolatedWorldReady) {
      reject(new Error('ISOLATED world not ready'));
      return;
    }

    const currentRequestId = ++requestId;
    pendingRequests.set(currentRequestId, { resolve, reject });

    window.postMessage({
      source: 'MTE_MAIN',
      type: 'getStorageData',
      requestId: currentRequestId
    }, window.location.origin);

    setTimeout(() => {
      if (pendingRequests.has(currentRequestId)) {
        pendingRequests.delete(currentRequestId);
        reject(new Error('Storage request timeout'));
      }
    }, 3000);
  });
};

// Reconcile the flag with extension storage as soon as the ISOLATED world is
// ready. Extension storage is global, so it corrects a stale per-origin mirror
// in either direction (pause started or cancelled on another subdomain).
const initializeWithStorage = async () => {
  try {
    const storageData = await getStorageData();
    const { unblockUntil = 0 } = storageData;
    const isUnblocked = Date.now() < unblockUntil;

    if (isUnblocked) {
      delete window.isManagedInternalTraffic;
    } else {
      window.isManagedInternalTraffic = true;
    }
  } catch (error) {
    // Keep whatever the synchronous check decided
  }
};

if (shouldBlock && typeof window.isManagedInternalTraffic === 'undefined') {
  window.isManagedInternalTraffic = true;
}
