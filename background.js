// background.js – Service worker for popup management and storage operations

// Keep service worker alive
const keepAlive = () => {
  chrome.runtime.getPlatformInfo(() => {});
};
setInterval(keepAlive, 20000);

// Helper function to update localStorage on a tab. Returns a promise so
// callers can wait for the write before reloading the page.
function updateLocalStorage(tabId, key, value) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (k, v) => {
      if (v === null) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, v);
      }
    },
    args: [key, value]
  }).catch(error => console.warn('localStorage sync failed:', error));
}

// Mirror the pause end time into the active tab's localStorage, then reload
// so the content script picks up the new state at document_start.
function syncActiveTab(until) {
  return chrome.tabs.query({ active: true, currentWindow: true })
    .then(async tabs => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      await updateLocalStorage(tabId, 'mte_unblock_until', until > 0 ? until.toString() : null);
      await chrome.tabs.reload(tabId);
    })
    .catch(error => console.warn('Tab sync failed:', error));
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Popup: set unblock state
  if (msg.type === 'setUnblock') {
    const hours = Number(msg.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      sendResponse({ success: false, error: 'Invalid pause duration' });
      return true;
    }

    const until = Date.now() + hours * 3600000;
    chrome.storage.local.set({ unblockUntil: until })
      .then(() => {
        sendResponse({ success: true });
        syncActiveTab(until);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }

  // Popup: get current status
  if (msg.type === "getStatus") {
    chrome.storage.local.get(["unblockUntil"])
      .then(({ unblockUntil = 0 }) => {
        const now = Date.now();
        const isUnblocked = now < unblockUntil;
        
        let statusMsg;
        if (now < unblockUntil) {
          const remMs = unblockUntil - now;
          const h = Math.floor(remMs / 3600000);
          const m = Math.floor((remMs % 3600000) / 60000);
          const s = Math.floor((remMs % 60000) / 1000);
          statusMsg = `Filter paused — ${h}h ${m}m ${s}s remaining`;
        } else {
          statusMsg = "Active — your activity is excluded";
        }
        
        sendResponse({ 
          status: statusMsg,
          isUnblocked: isUnblocked,
          unblockUntil: unblockUntil
        });
      })
      .catch(error => {
        sendResponse({ 
          status: "Error loading status",
          isUnblocked: false,
          error: error.message
        });
      });
    return true;
  }

  // Popup: clear unblock (re-enable blocking)
  if (msg.type === "clearUnblock") {
    chrome.storage.local.set({ unblockUntil: 0 })
      .then(() => {
        sendResponse({ success: true });
        syncActiveTab(0);
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Content script: get storage data
  if (msg.type === "getStorageData") {
    chrome.storage.local.get(["unblockUntil"])
      .then(data => {
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  sendResponse({ success: false, error: "Unknown message type" });
  return true;
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ unblockUntil: 0 })
      .catch(error => console.warn('Storage init failed:', error));
  } else if (details.reason === 'update') {
    // Permanent opt-out no longer exists; clear any leftover flag from older versions
    chrome.storage.local.remove('permanentUnblock')
      .catch(error => console.warn('Storage cleanup failed:', error));
  }
});
