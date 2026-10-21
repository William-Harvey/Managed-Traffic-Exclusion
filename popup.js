// popup.js - Enhanced popup functionality with improved error handling

// DOM element references
const statusEl = document.getElementById('status');
const btn1h = document.getElementById('btn1h');
const btn4h = document.getElementById('btn4h');
const btn8h = document.getElementById('btn8h');
const btnReblock = document.getElementById('btnReblock');
const whatIsThis = document.getElementById('whatIsThis');
const activeView = document.getElementById('active-view');
const inactiveView = document.getElementById('inactive-view');
const statusLabel = document.getElementById('statusLabel');

// State variables
let isLoading = false;
let countdownInterval = null;

// Extension context management
const handleContextInvalidation = () => {
  // Clear any loading states immediately
  setLoading(false);
  
  // Clear any running intervals
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  // Show recovery message
  showError('Extension reloaded. Please close and reopen this popup.');
  
  // Disable all interactive elements to prevent further errors
  document.querySelectorAll('button, input').forEach(el => {
    el.disabled = true;
    el.style.opacity = '0.5';
  });
};

const checkExtensionContext = () => {
  try {
    // Check if we're in a test environment (no Chrome APIs)
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      // In test mode, don't invalidate context
      if (typeof chrome === 'undefined') {
        return false; // Test mode
      }
      handleContextInvalidation();
      return false;
    }
    return true;
  } catch (error) {
    // If chrome is undefined, we're in test mode
    if (typeof chrome === 'undefined') {
      return false; // Test mode
    }
    handleContextInvalidation();
    return false;
  }
};

// Safe runtime messaging with context validation
const safeRuntimeMessage = (message, callback) => {
  if (!checkExtensionContext()) {
    setLoading(false);
    callback && callback(null, { message: 'Extension context invalidated' });
    return;
  }
  
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message;
        
        setLoading(false);
        callback && callback(null, { message: errorMsg });
      } else {
        callback && callback(response);
      }
    });
  } catch (error) {
    setLoading(false);
    callback && callback(null, { message: 'Message sending failed' });
  }
};

// Utility functions
const setLoading = (loading) => {
  isLoading = loading;
  // No visual changes - just track state internally
};

const showError = (message) => {
  // Provide more user-friendly messages for common errors
  let userMessage = message;
  if (message.includes('Extension context invalidated') || 
      message.includes('Extension was reloaded') ||
      message.includes('Extension needs to be reloaded')) {
    userMessage = 'Extension was reloaded. Please close and reopen this popup.';
  }
  
  const errorElement = document.getElementById('errorMessage');
  errorElement.textContent = userMessage;
  errorElement.classList.remove('hidden');

  // Auto-hide error after 5 seconds
  setTimeout(() => {
    errorElement.classList.add('hidden');
  }, 5000);
};

const showSuccess = (message) => {
  statusEl.textContent = message;
  statusEl.className = 'status-value success';
};

const showStatus = (message) => {
  statusEl.textContent = message;
  statusEl.className = 'status-value';
};

const setStatusLabel = (state) => {
  const labels = { active: 'Current Status: Active', paused: 'Current Status: Paused' };
  statusLabel.textContent = labels[state] || 'Current Status';
  statusLabel.classList.toggle('active', state === 'active');
};

// Function to check if the current domain is allowed by manifest permissions
const isDomainAllowed = (url) => {
  if (!url) {
    return false;
  }
  
  // Host permissions from manifest.json
  const allowedHosts = [
    "*://*.bbc.com/*",
    "*://*.bbc.co.uk/*"
  ];
  
  const currentHostname = new URL(url).hostname;

  for (const hostPattern of allowedHosts) {
    // Convert manifest pattern to a simple regex-like format
    const domain = hostPattern
      .replace("*://*.", "")
      .replace("*://", "")
      .replace("/*", "");
      
    if (currentHostname === domain || currentHostname.endsWith("." + domain)) {
      return true;
    }
  }
  
  return false;
};

// Initialize popup functionality
const initPopup = () => {
  // First, check the domain of the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    
    // If the domain is not allowed, show the inactive message and stop
    if (!currentTab || !isDomainAllowed(currentTab.url)) {
      activeView.classList.add('hidden');
      inactiveView.classList.remove('hidden');
      // Adjust body size for the smaller inactive popup
      document.body.style.height = 'auto';
      return;
    }

    // If domain is allowed, proceed with the original initialization
    activeView.classList.remove('hidden');
    inactiveView.classList.add('hidden');
  
    // Check if DOM elements exist
    const elements = {
      btn1h, btn4h, btn8h, btnReblock, statusEl
    };
    
    for (const [name, element] of Object.entries(elements)) {
      if (!element) {
        showError(`Interface error: Missing element ${name}`);
        return;
      }
    }
    
    // Check extension context before proceeding
    const hasExtensionContext = checkExtensionContext();
    if (!hasExtensionContext && typeof chrome !== 'undefined') {
      showError('Extension connection lost. Please close and reopen this popup.');
      return;
    }
    
    // Hide re-enable blocking section by default (will be shown if blocking is disabled)
    btnReblock.classList.add('hidden');
    
    // Initial status update
    if (hasExtensionContext) {
      updateStatus();
    } else {
      // Test mode - show default blocked state
      setStatusLabel('active');
      showStatus('Your activity is excluded (Test Mode)');
      btnReblock.classList.add('hidden');

      // Listen for test messages
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'testState') {
          simulateStatusUpdate(event.data);
        }
      });
    }
  });
};

// Simulate status update for testing
const simulateStatusUpdate = (testData) => {
  if (testData.isUnblocked) {
    // Show the re-enable blocking section when unblocked
    btnReblock.classList.remove('hidden');
    
    if (testData.unblockUntil) {
      startCountdown(testData.unblockUntil);
    }
  } else {
    // Hide the re-enable blocking section when blocking is active
    btnReblock.classList.add('hidden');
    setStatusLabel('active');
    showStatus('Your activity is excluded (Test Mode)');
    clearCountdown();
  }
};

// Update status display with countdown if unblocked
const updateStatus = () => {
  safeRuntimeMessage({ type: 'getStatus' }, (response, error) => {
    if (error) {
      showError('Failed to get blocking status');
      return;
    }
    
    if (response && response.isUnblocked) {
      // Show the re-enable blocking section when unblocked
      btnReblock.classList.remove('hidden');
      
      if (response.unblockUntil) {
        startCountdown(response.unblockUntil);
      }
    } else {
      // Hide the re-enable blocking section when blocking is active
      btnReblock.classList.add('hidden');
      setStatusLabel('active');
      showStatus('Your activity is excluded');
      clearCountdown();
    }
  });
};

// Countdown timer for temporary unblock
const startCountdown = (unblockUntil) => {
  clearCountdown();
  
  const updateCountdown = () => {
    const now = Date.now();
    const remaining = unblockUntil - now;
    
    if (remaining <= 0) {
      setStatusLabel('active');
      showStatus('Your activity is excluded');
      btnReblock.classList.add('hidden');
      clearCountdown();
      return;
    }
    
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
    
    setStatusLabel('paused');
    showSuccess(`${hours}h ${minutes}m ${seconds}s remaining`);
  };
  
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
};

const clearCountdown = () => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
};

// Handle temporary unblock
const handleTempUnblock = (hours) => {
  if (isLoading) {
    return;
  }
  
  setLoading(true);
  showStatus('Pausing filter...');
  
  safeRuntimeMessage({
    type: 'setUnblock',
    hours: hours
  }, (response, error) => {
    if (error) {
      showError('Failed to set temporary unblock');
      setLoading(false);
      return;
    }
    
    if (response && response.success) {
      setLoading(false);
      showSuccess(`Filter paused for ${hours} hour${hours > 1 ? 's' : ''}`);
      
      // Update status immediately
      updateStatus();
    } else {
      setLoading(false);
      showError(response?.error || 'Failed to set temporary unblock');
    }
  });
};

// Handle re-enable blocking
const handleReblock = () => {
  if (isLoading) return;
  
  setLoading(true);
  showStatus('Resuming filter...');
  
  safeRuntimeMessage({
    type: 'clearUnblock'
  }, (response, error) => {
    setLoading(false);
    
    if (error) {
      showError('Failed to re-enable blocking');
      return;
    }
    
    if (response && response.success) {
      showSuccess('Filter resumed');
      updateStatus();
    } else {
      showError('Failed to re-enable blocking');
    }
  });
};

// Event listeners
btn1h.addEventListener('click', () => {
  handleTempUnblock(1);
});
btn4h.addEventListener('click', () => {
  handleTempUnblock(3);
});
btn8h.addEventListener('click', () => {
  handleTempUnblock(6);
});
btnReblock.addEventListener('click', () => {
  handleReblock();
});
const whatIsThisMessage = 'This extension was implemented at the request of the Marketing team to improve the accuracy of our CRM and analytics data.\n\nBy filtering out internal employee traffic, reports reflect only genuine customer and prospect activity. This gives teams across the business cleaner, more reliable data for decision-making.\n\nThe filter runs automatically — no action is required on your part.';

whatIsThis.addEventListener('click', (e) => {
  e.preventDefault();
  alert(whatIsThisMessage);
});

const whatIsThisInactive = document.getElementById('whatIsThisInactive');
if (whatIsThisInactive) {
  whatIsThisInactive.addEventListener('click', (e) => {
    e.preventDefault();
    alert(whatIsThisMessage);
  });
}

// Handle runtime errors
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'error') {
    showError(message.message);
  }
});

// Cleanup when popup is closed
window.addEventListener('beforeunload', () => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
