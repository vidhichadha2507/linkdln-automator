// background.js

let safetyTimeout = null;

// Centralized helper to write to real-time logs in local storage
function addLog(message) {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    message
  };
  chrome.storage.local.get({ automationLogs: [] }, (result) => {
    const logs = result.automationLogs || [];
    logs.push(logEntry);
    if (logs.length > 50) logs.shift(); // Limit to last 50 logs
    chrome.storage.local.set({ automationLogs: logs }, () => {
      // Broadcast log update to popup if open
      chrome.runtime.sendMessage({ type: "NEW_LOG", log: logEntry }).catch(() => {
        // Ignore errors if popup is closed
      });
    });
  });
}

// Close the Mailmeteor search tab to prevent background tab CPU/memory throttling
function closeMailmeteorTab() {
  chrome.storage.local.get("mailmeteorTabId", (res) => {
    if (res.mailmeteorTabId) {
      const tabId = res.mailmeteorTabId;
      chrome.storage.local.set({ mailmeteorTabId: null }, () => {
        chrome.tabs.remove(tabId).catch(() => {});
      });
    }
  });
}

// Setup persistent alarm check for Manifest V3 background worker auto-healing (every 1 min)
chrome.alarms.create("queueHeartbeat", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "queueHeartbeat") {
    processNextInQueue();
    checkAndTriggerJobSearch();
  } else if (alarm.name === "rateLimitRetryCheck") {
    chrome.storage.local.get("rateLimitRetryUrl", (result) => {
      const retryUrl = result.rateLimitRetryUrl || "";
      addLog(`Rate limit retry timer finished. Resuming queue to retry search...`);
      chrome.storage.local.set({ rateLimitRetryActiveUntil: 0 }, () => {
        processNextInQueue();
      });
    });
  } else if (alarm.name.startsWith("searchTimeout_")) {
    const profileUrl = alarm.name.substring("searchTimeout_".length);
    chrome.storage.local.get("automationQueue", (result) => {
      const queue = result.automationQueue || [];
      if (queue.length > 0 && queue[0].profileUrl === profileUrl) {
        addLog(`Alarm check: Timeout limit (1m) exceeded for ${queue[0].fullName}. Skipping...`);
        removeProfileFromQueue(profileUrl);
      }
    });
  }
});

// Startup recovery: resume queue if background service worker was restarted/woken up
chrome.storage.local.get({ automationQueue: [] }, (result) => {
  const queue = result.automationQueue || [];
  if (queue.length > 0) {
    addLog(`Automator restarted. Resuming active queue (${queue.length} pending)...`);
    // Reset running status to false initially to bootstrap processing
    chrome.storage.local.set({ isAutomationRunning: false }, () => {
      processNextInQueue();
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LOG") {
    addLog(message.message);
    return;
  }

  if (message.type === "GET_JOB_SEARCH_SETTINGS") {
    fetch("http://localhost:4000/admin/settings")
      .then(res => res.json())
      .then(settings => {
        sendResponse({ settings });
      })
      .catch(err => {
        console.error("Failed to fetch settings for scraper:", err);
        sendResponse({ settings: null });
      });
    return true; // Keep message channel open for async response
  }

  if (message.type === "HARVESTED_JOBS_RESULT") {
    const { jobs } = message;
    addLog(`Received ${jobs.length} harvested jobs from scraper. Syncing with backend...`);
    
    fetch("http://localhost:4000/job-search/harvest-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobs)
    })
    .then(res => res.json())
    .then(result => {
      if (result.success) {
        addLog(`Successfully synced harvested jobs. Added: ${result.addedJobsCount} jobs, ${result.addedCompaniesCount} new companies.`);
      } else {
        addLog(`Backend failed to sync jobs: ${result.message}`);
      }
    })
    .catch(err => {
      addLog(`Error syncing harvested jobs with backend: ${err.message || err}`);
    })
    .finally(() => {
      if (jobs && jobs.length > 0) {
        closeJobSearchTab();
      } else {
        addLog("No jobs were harvested. Keeping LinkedIn tab open for inspection.");
        chrome.storage.local.set({ isJobSearchRunning: false, jobSearchTabId: null });
      }
    });
    return;
  }

  if (message.type === "START_AUTOMATION") {
    const { profile } = message;
    if (!profile || !profile.profileUrl) return;

    chrome.storage.local.get({ automationQueue: [], processingUrls: [] }, (result) => {
      const queue = result.automationQueue || [];
      const processing = result.processingUrls || [];

      // Avoid duplicates in the active queue
      if (!queue.some(item => item.profileUrl === profile.profileUrl)) {
        queue.push(profile);
        processing.push(profile.profileUrl);

        chrome.storage.local.set({ automationQueue: queue, processingUrls: processing }, () => {
          addLog(`Added ${profile.fullName} to search queue. Queue position: ${queue.length}.`);
          processNextInQueue();
        });
      }
    });
    return;
  }

  if (message.type === "AUTOMATION_COMPLETE") {
    const { profileUrl, lead, success } = message;
    clearTimeout(safetyTimeout);

    addLog(`Automation completed for profile URL.`);
    
    if (success && lead) {
      // Sync lead to shared local storage first
      chrome.storage.local.get({ extractedLeads: [] }, (result) => {
        const list = result.extractedLeads || [];
        if (!list.some(item => item.email.toLowerCase() === lead.email.toLowerCase())) {
          list.unshift(lead);
          chrome.storage.local.set({ extractedLeads: list });
        }
      });
    }

    chrome.storage.local.set({
      rateLimitRetryCount: 0,
      rateLimitRetryUrl: "",
      rateLimitRetryActiveUntil: 0
    }, () => {
      removeProfileFromQueue(profileUrl);
    });
    return;
  }

  if (message.type === "AUTOMATION_FAILED") {
    const { profileUrl, reason } = message;
    clearTimeout(safetyTimeout);
    addLog(`Automation failed: ${reason || "Unknown error"}. Skipping...`);
    
    chrome.storage.local.set({
      rateLimitRetryCount: 0,
      rateLimitRetryUrl: "",
      rateLimitRetryActiveUntil: 0
    }, () => {
      removeProfileFromQueue(profileUrl);
    });
    return;
  }

  if (message.type === "AUTOMATION_RATELIMIT") {
    const { profileUrl, reason } = message;
    clearTimeout(safetyTimeout);
    chrome.alarms.clear("searchTimeout_" + profileUrl);

    chrome.storage.local.get(["rateLimitRetryCount", "rateLimitRetryUrl", "automationQueue"], (result) => {
      const retryCount = result.rateLimitRetryCount || 0;
      const retryUrl = result.rateLimitRetryUrl || "";
      const queue = result.automationQueue || [];
      const currentItem = queue.find(item => item.profileUrl === profileUrl) || { fullName: "Contact" };

      if (retryUrl === profileUrl && retryCount >= 1) {
        // Consecutive rate limit - pause queue
        chrome.storage.local.set({
          isAutomationRunning: false,
          isQueuePaused: true,
          queuePauseReason: "Rate Limit (Consecutive)",
          rateLimitRetryCount: 0,
          rateLimitRetryUrl: "",
          rateLimitRetryActiveUntil: 0
        }, () => {
          addLog(`Automation PAUSED: Rate limit hit again consecutively for ${currentItem.fullName}. Profile remains at front of queue.`);
          chrome.runtime.sendMessage({ type: "QUEUE_PAUSED", reason: "Rate Limit (Consecutive)" }).catch(() => {});
        });
      } else {
        // First rate limit - wait 1 minute and retry once
        const resumeTime = Date.now() + 60000;
        chrome.storage.local.set({
          isAutomationRunning: false,
          rateLimitRetryCount: 1,
          rateLimitRetryUrl: profileUrl,
          rateLimitRetryActiveUntil: resumeTime
        }, () => {
          addLog(`Rate limit detected for ${currentItem.fullName}. Waiting 1 minute before retrying once...`);
          chrome.alarms.create("rateLimitRetryCheck", { delayInMinutes: 1 });
        });
      }
    });
    return;
  }

  if (message.type === "PAUSE_QUEUE_MANUALLY") {
    clearTimeout(safetyTimeout);
    chrome.alarms.clear("rateLimitRetryCheck");
    closeMailmeteorTab();
    chrome.storage.local.set({
      isAutomationRunning: false,
      isQueuePaused: true,
      queuePauseReason: "Manually Paused",
      rateLimitRetryActiveUntil: 0,
      rateLimitRetryCount: 0,
      rateLimitRetryUrl: ""
    }, () => {
      addLog("Automation PAUSED manually. Profile remains at front of queue.");
      chrome.runtime.sendMessage({ type: "QUEUE_PAUSED", reason: "Manually Paused" }).catch(() => {});
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "FORCE_RESUME_QUEUE") {
    chrome.alarms.clear("rateLimitRetryCheck");
    chrome.storage.local.set({ 
      isAutomationRunning: false,
      isQueuePaused: false,
      queuePauseReason: null,
      rateLimitRetryCount: 0,
      rateLimitRetryUrl: "",
      rateLimitRetryActiveUntil: 0
    }, () => {
      addLog("Manual queue override triggered: Resetting running/paused state and resuming queue...");
      processNextInQueue();
    });
    sendResponse({ success: true });
    return true;
  }
});

// Remove processed item from queue and start next search
function removeProfileFromQueue(profileUrl) {
  chrome.alarms.clear("searchTimeout_" + profileUrl);
  closeMailmeteorTab();
  chrome.storage.local.get({ 
    automationQueue: [], 
    processingUrls: [],
    rateLimitRetryUrl: ""
  }, (result) => {
    let queue = result.automationQueue || [];
    let processing = result.processingUrls || [];
    const retryUrl = result.rateLimitRetryUrl || "";

    queue = queue.filter(item => item.profileUrl !== profileUrl);
    processing = processing.filter(url => url !== profileUrl);

    const updates = { 
      automationQueue: queue, 
      processingUrls: processing,
      isAutomationRunning: false // Reset running state so next item can run
    };

    if (retryUrl === profileUrl) {
      chrome.alarms.clear("rateLimitRetryCheck");
      updates.rateLimitRetryCount = 0;
      updates.rateLimitRetryUrl = "";
      updates.rateLimitRetryActiveUntil = 0;
    }

    chrome.storage.local.set(updates, () => {
      // Signal all LinkedIn tabs to refresh states (turning "Processing" to "Saved")
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(t => {
          if (t.url && t.url.includes("linkedin.com")) {
            chrome.tabs.sendMessage(t.id, { type: "REFRESH_SAVED_PROFILES" }).catch(() => {});
          }
        });
      });
      processNextInQueue();
    });
  });
}

// Process the next item in the queue
function processNextInQueue() {
  chrome.storage.local.get(["automationQueue", "isAutomationRunning", "lastSearchStartedAt", "isQueuePaused", "rateLimitRetryActiveUntil"], (result) => {
    const queue = result.automationQueue || [];
    const isRunning = result.isAutomationRunning || false;
    const lastStarted = result.lastSearchStartedAt || 0;
    const isPaused = result.isQueuePaused || false;
    const activeUntil = result.rateLimitRetryActiveUntil || 0;

    if (isPaused) {
      // Early return as queue is paused
      return;
    }

    if (activeUntil > 0 && Date.now() < activeUntil) {
      // Early return as we are waiting for rate limit retry
      return;
    }

    if (isRunning) {
      // Check if it timed out (e.g. 25 seconds passed)
      if (lastStarted > 0 && Date.now() - lastStarted > 25000) {
        addLog(`Safety check: Detected stuck queue item (timed out after 25s). Auto-healing queue...`);
        if (queue.length > 0) {
          const stuckItem = queue[0];
          addLog(`Timeout limit (25s) exceeded for ${stuckItem.fullName}. Skipping...`);
          removeProfileFromQueue(stuckItem.profileUrl);
        } else {
          chrome.storage.local.set({ isAutomationRunning: false }, () => {
            processNextInQueue();
          });
        }
      }
      return;
    }

    if (queue.length === 0) {
      chrome.storage.local.set({ pendingAutomationSearch: null });
      return;
    }

    // Set running state and timestamp in storage to survive service worker lifecycle restarts
    const now = Date.now();
    chrome.storage.local.set({ 
      isAutomationRunning: true,
      lastSearchStartedAt: now
    }, () => {
      const currentItem = queue[0];
      addLog(`Searching Mailmeteor in background for: ${currentItem.fullName}...`);

      chrome.storage.local.set({ pendingAutomationSearch: currentItem.profileUrl }, () => {
        // Setup a backup alarm for 1 minute as service worker wakeup timeout
        chrome.alarms.create("searchTimeout_" + currentItem.profileUrl, { delayInMinutes: 1 });

        // Query current active tab (the user's LinkedIn browsing tab) to restore focus
        chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
          const activeTab = activeTabs[0];
          const mailmeteorSearchUrl = `https://mailmeteor.com/tools/linkedin-email-finder?linkedin-url=${encodeURIComponent(currentItem.profileUrl)}`;

          // Query for any open Mailmeteor tabs
          chrome.tabs.query({ url: ["*://*.mailmeteor.com/*", "*://mailmeteor.com/*"] }, (tabs) => {
            if (tabs && tabs.length > 0) {
              const targetTab = tabs[0];
              addLog(`Updating background Mailmeteor tab (${targetTab.id}).`);
              chrome.storage.local.set({ mailmeteorTabId: targetTab.id }, () => {
                chrome.tabs.update(targetTab.id, { url: mailmeteorSearchUrl, active: false });
              });
            } else {
              addLog("Opening new Mailmeteor tab in background...");
              chrome.tabs.create({ url: mailmeteorSearchUrl, active: false }, (newTab) => {
                if (newTab) {
                  chrome.storage.local.set({ mailmeteorTabId: newTab.id });
                }
              });
            }

            // Safety timeout safeguard: 25 seconds max per profile
            clearTimeout(safetyTimeout);
            safetyTimeout = setTimeout(() => {
              addLog(`Timeout limit (25s) exceeded for ${currentItem.fullName}. Skipping...`);
              removeProfileFromQueue(currentItem.profileUrl);
            }, 25000);
          });
        });
      });
    });
  });
}

// Listen for tab updates (URL changes / SPA navigation) to notify content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes("linkedin.com")) {
    chrome.tabs.sendMessage(tabId, { type: "URL_CHANGED", url: changeInfo.url }).catch(() => {
      // Ignore errors if content script not loaded on this tab yet
    });
    // Auto-heal check on URL change
    processNextInQueue();
  }
});

// Listen for tab removals to handle manual closures by the user/browser
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get(["mailmeteorTabId", "automationQueue", "isAutomationRunning", "jobSearchTabId"], (result) => {
    if (result.mailmeteorTabId === tabId && result.isAutomationRunning) {
      addLog("Mailmeteor processing tab was closed. Skipping to next profile...");
      chrome.storage.local.set({ mailmeteorTabId: null }, () => {
        if (result.automationQueue && result.automationQueue.length > 0) {
          removeProfileFromQueue(result.automationQueue[0].profileUrl);
        }
      });
    }
    if (result.jobSearchTabId === tabId) {
      addLog("LinkedIn Job Search tab was closed.");
      chrome.storage.local.set({ jobSearchTabId: null, isJobSearchRunning: false });
    }
  });
});

async function checkAndTriggerJobSearch() {
  try {
    const res = await fetch("http://localhost:4000/admin/settings");
    if (!res.ok) return;
    const settings = await res.json();
    
    if (!settings.jobSearchEnabled) {
      return;
    }
    
    chrome.storage.local.get(["lastJobSearchTime", "isJobSearchRunning"], (store) => {
      if (store.isJobSearchRunning) {
        // Check if it has been running for too long (e.g., timeout of 3 minutes)
        if (store.lastJobSearchTime && Date.now() - store.lastJobSearchTime > 180000) {
          addLog("Job search has been running for more than 3 minutes. Timing out/resetting.");
          chrome.storage.local.set({ isJobSearchRunning: false });
          closeJobSearchTab();
        }
        return;
      }
      
      const intervalMs = (settings.jobSearchInterval || 10) * 60 * 1000;
      const lastTime = store.lastJobSearchTime || 0;
      if (Date.now() - lastTime >= intervalMs) {
        addLog("Triggering automated LinkedIn Job Search...");
        chrome.storage.local.set({ isJobSearchRunning: true, lastJobSearchTime: Date.now() }, () => {
          triggerJobSearch(settings);
        });
      }
    });
  } catch (err) {
    console.error("Error checking/triggering job search:", err);
  }
}

function triggerJobSearch(settings) {
  const query = encodeURIComponent(settings.jobSearchQuery || "DevOps Engineer");
  const wtCodes = [];
  const wtSetting = (settings.jobSearchWorkplaceTypes || "").toLowerCase();
  if (wtSetting.includes("on-site") || wtSetting.includes("onsite") || wtSetting.includes("on site")) wtCodes.push(1);
  if (wtSetting.includes("remote")) wtCodes.push(2);
  if (wtSetting.includes("hybrid")) wtCodes.push(3);
  const wtParam = wtCodes.length > 0 ? `&f_WT=${wtCodes.join("%2C")}` : "";
  
  // Entry Level (2) + Associate (3) experience levels
  const timeParam = settings.jobSearchTimeRange || "r604800";
  const url = `https://www.linkedin.com/jobs/search/?keywords=${query}&location=India&f_TPR=${timeParam}${wtParam}&f_E=2%2C3`;
  
  addLog(`Opening LinkedIn job search: ${url}`);
  chrome.tabs.create({ url, active: false }, (tab) => {
    if (tab) {
      chrome.storage.local.set({ jobSearchTabId: tab.id });
    }
  });
}

function closeJobSearchTab() {
  chrome.storage.local.get("jobSearchTabId", (res) => {
    if (res.jobSearchTabId) {
      const tabId = res.jobSearchTabId;
      chrome.storage.local.set({ jobSearchTabId: null, isJobSearchRunning: false }, () => {
        chrome.tabs.remove(tabId).catch(() => {});
      });
    }
  });
}

// Reset running lock and run immediate check on extension startup/load
chrome.storage.local.set({ isJobSearchRunning: false, jobSearchTabId: null, lastJobSearchTime: 0 }, () => {
  checkAndTriggerJobSearch();
});

// Periodically check and trigger job search every 15 seconds to detect settings updates instantly
setInterval(checkAndTriggerJobSearch, 15000);

