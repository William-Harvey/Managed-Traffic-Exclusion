// isolatedContentScript.js – ISOLATED world content script
// Handles Chrome API access and communication with MAIN world

// Minimal logging for isolated content script

// Extension context validation
let extensionContextValid = true;

const checkExtensionContext = () => {
  try {
    if (!chrome.runtime || !chrome.runtime.sendMessage || !chrome.runtime.id) {
      extensionContextValid = false;
      return false;
    }
    return true;
  } catch (error) {
    extensionContextValid = false;
    console.warn("MTE: Extension context invalidated:", error.message);
    return false;
  }
};

// Safe runtime messaging with context validation
const safeRuntimeMessage = (message, callback) => {
  if (!checkExtensionContext()) {
    callback && callback(null, { message: 'Extension context invalidated' });
    return;
  }
  
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        
        // Check if this is a context invalidation error
        if (errorMsg.includes('Extension context invalidated') || 
            errorMsg.includes('Extension was invalidated') ||
            errorMsg.includes('receiving end does not exist')) {
          extensionContextValid = false;
        }
        
        callback && callback(null, { message: errorMsg });
      } else {
        callback && callback(response);
      }
    });
  } catch (error) {
    extensionContextValid = false;
    callback && callback(null, { message: 'Message sending failed' });
  }
};

// Listen for messages from MAIN world
window.addEventListener('message', (event) => {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) {
    return;
  }
  
  // Only handle MTE messages
  if (!event.data || event.data.source !== 'MTE_MAIN') {
    return;
  }
  
  // Handle storage data request
  if (event.data.type === 'getStorageData') {
    // Check if extension context is still valid
    if (!extensionContextValid) {
      window.postMessage({
        source: 'MTE_ISOLATED',
        type: 'storageDataResponse',
        requestId: event.data.requestId,
        success: false,
        error: 'Extension context invalidated'
      }, window.location.origin);
      return;
    }
    
    // Send message to background script to get storage data
    safeRuntimeMessage({
      type: 'getStorageData'
    }, (response, error) => {
      if (error) {
        // Send error back to MAIN world
        window.postMessage({
          source: 'MTE_ISOLATED',
          type: 'storageDataResponse',
          requestId: event.data.requestId,
          success: false,
          error: error.message || error
        }, window.location.origin);
      } else {
        // Send data back to MAIN world
        window.postMessage({
          source: 'MTE_ISOLATED',
          type: 'storageDataResponse',
          requestId: event.data.requestId,
          success: response?.success || false,
          data: response?.data || null,
          error: response?.error || null
        }, window.location.origin);
      }
    });
  }
});

// Keep this origin's localStorage mirror in step with extension storage so the
// MAIN world script can read the pause state synchronously on the next load.
// (localStorage is per origin, so a pause started on one subdomain is not
// otherwise visible to the others.)
const syncLocalStorageMirror = () => {
  if (!checkExtensionContext()) return;
  try {
    chrome.storage.local.get(['unblockUntil'], (data) => {
      if (chrome.runtime.lastError) return;
      const until = Number(data?.unblockUntil) || 0;
      try {
        if (until > Date.now()) {
          localStorage.setItem('mte_unblock_until', until.toString());
        } else {
          localStorage.removeItem('mte_unblock_until');
        }
      } catch (e) { /* storage blocked */ }
    });
  } catch (e) { /* ignore */ }
};
syncLocalStorageMirror();

// Send ready signal to MAIN world after ensuring context is valid
if (checkExtensionContext()) {
  window.postMessage({
    source: 'MTE_ISOLATED',
    type: 'ready'
  }, window.location.origin);
}
