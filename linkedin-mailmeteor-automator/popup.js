// Backend API URL — change this if you deploy to a different Vercel project
const BACKEND_URL = "https://linkdln-automator-vidhichadha2507s-projects.vercel.app";

let allProfiles = [];
let allLeads = [];
let allLogs = [];
let allQueue = [];
let allJobs = [];
let activeTab = "profiles";
let elapsedTimer = null;
let retryCountdownTimer = null;
let profilesFilter = "all";
let leadsFilter = "all";

function cleanUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, "");
  } catch (e) {
    return url.toLowerCase().trim().replace(/\/+$/, "");
  }
}

// Lightweight vanilla DOM reconciliation system
function reconcileList(container, dataItems, cardCreator, idSelector) {
  const existingCards = new Map();
  const children = Array.from(container.children);
  children.forEach(child => {
    const cardId = child.getAttribute("data-card-id");
    if (cardId) {
      existingCards.set(cardId, child);
    }
  });

  const usedIds = new Set();

  dataItems.forEach((item, index) => {
    const cardId = String(idSelector(item));
    usedIds.add(cardId);

    let card = existingCards.get(cardId);
    const isUpdate = !!card;

    if (!isUpdate) {
      card = document.createElement("div");
      card.setAttribute("data-card-id", cardId);
    }

    cardCreator(card, item, isUpdate, index);

    const currentChildAtIndex = container.children[index];
    if (currentChildAtIndex !== card) {
      if (currentChildAtIndex) {
        container.insertBefore(card, currentChildAtIndex);
      } else {
        container.appendChild(card);
      }
    }
  });

  children.forEach(child => {
    const cardId = child.getAttribute("data-card-id");
    if (cardId && !usedIds.has(cardId)) {
      container.removeChild(child);
    }
  });
}

const elements = {
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabViews: document.querySelectorAll(".tab-view"),
  profileSearch: document.getElementById("profileSearch"),
  leadSearch: document.getElementById("leadSearch"),
  profilesList: document.getElementById("profilesList"),
  leadsList: document.getElementById("leadsList"),
  profilesEmptyState: document.getElementById("profilesEmptyState"),
  leadsEmptyState: document.getElementById("leadsEmptyState"),
  terminalBody: document.getElementById("terminalBody"),
  statsLabel: document.getElementById("statsLabel"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  goToLinkedinBtn: document.getElementById("goToLinkedinBtn"),
  goToMailmeteorBtn: document.getElementById("goToMailmeteorBtn"),
  statusIndicator: document.getElementById("statusIndicator"),
  statusText: document.getElementById("statusText"),
  internalToast: document.getElementById("internalToast"),
  forceResumeQueueBtn: document.getElementById("forceResumeQueueBtn"),
  queueConsoleList: document.getElementById("queueConsoleList"),
  queueConsoleEmptyState: document.getElementById("queueConsoleEmptyState"),
  queueConsoleStatus: document.getElementById("queueConsoleStatus"),
  queueConsoleCount: document.getElementById("queueConsoleCount"),
  queueConsoleEstTime: document.getElementById("queueConsoleEstTime"),
  activeSearchSection: document.getElementById("activeSearchSection"),
  activeSearchCard: document.getElementById("activeSearchCard"),
  upNextSection: document.getElementById("upNextSection"),
  pauseQueueBtn: document.getElementById("pauseQueueBtn"),
  jobsList: document.getElementById("jobsList"),
  jobsEmptyState: document.getElementById("jobsEmptyState"),
  jobRoleInput: document.getElementById("jobRoleInput"),
  jobCompanyInput: document.getElementById("jobCompanyInput"),
  jobLinkInput: document.getElementById("jobLinkInput"),
  saveJobBtn: document.getElementById("saveJobBtn"),
  extractJobBtn: document.getElementById("extractJobBtn")
};

// Initialize Popup
document.addEventListener("DOMContentLoaded", () => {
  // Enforce popup dimensions programmatically to bust Chrome's popup sizing cache
  document.documentElement.style.width = '400px';
  document.documentElement.style.height = '600px';
  document.body.style.width = '400px';
  document.body.style.height = '600px';

  loadData();
  setupEventListeners();
  updateStatusBadge();
});

// Load data from chrome.storage.local
function loadData() {
  chrome.storage.local.get({ savedProfiles: [], extractedLeads: [], automationLogs: [], automationQueue: [] }, (result) => {
    allProfiles = result.savedProfiles || [];
    allLeads = result.extractedLeads || [];
    allLogs = result.automationLogs || [];
    allQueue = result.automationQueue || [];
    renderUI();
  });
}

// Check pending automation search to set active status badge
function updateStatusBadge() {
  chrome.storage.local.get(["pendingAutomationSearch", "automationQueue", "isQueuePaused", "queuePauseReason", "rateLimitRetryActiveUntil"], (result) => {
    const queue = result.automationQueue || [];
    const isPaused = result.isQueuePaused || false;
    const pauseReason = result.queuePauseReason || "";
    const activeUntil = result.rateLimitRetryActiveUntil || 0;
    const isWaitingRetry = activeUntil > Date.now();

    if (isPaused) {
      elements.statusIndicator.className = "status-badge status-paused";
      elements.statusText.textContent = pauseReason.includes("Limit") ? "Paused (Limit)" : "Paused";
    } else if (isWaitingRetry) {
      elements.statusIndicator.className = "status-badge status-working";
      elements.statusText.textContent = "Waiting Retry...";
    } else if (result.pendingAutomationSearch || queue.length > 0) {
      elements.statusIndicator.className = "status-badge status-working";
      elements.statusText.textContent = queue.length > 1 
        ? `Searching (${queue.length - 1} pending)` 
        : "Searching...";
    } else {
      elements.statusIndicator.className = "status-badge status-idle";
      elements.statusText.textContent = "Idle";
    }
    
    // Refresh active views
    if (activeTab === "queue") {
      renderQueueConsole();
    }
  });
}

// Start elapsed counter timer in real-time
function startElapsedTimer(startTime) {
  if (elapsedTimer) clearInterval(elapsedTimer);
  
  const timerBadge = document.getElementById("elapsedTimeBadge");
  if (!timerBadge) return;

  const update = () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    timerBadge.textContent = `${elapsed}s elapsed`;
    if (elapsed > 25) {
      timerBadge.style.backgroundColor = "var(--danger-color)";
      timerBadge.style.color = "#ffffff";
      timerBadge.style.borderColor = "var(--danger-color)";
    } else {
      timerBadge.style.backgroundColor = "rgba(245, 158, 11, 0.15)";
      timerBadge.style.color = "#f59e0b";
      timerBadge.style.borderColor = "rgba(245, 158, 11, 0.3)";
    }
  };
  
  update();
  elapsedTimer = setInterval(update, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (retryCountdownTimer) {
    clearInterval(retryCountdownTimer);
    retryCountdownTimer = null;
  }
}

// Start countdown timer for rate-limit retry wait
function startRetryTimer(activeUntil) {
  if (retryCountdownTimer) clearInterval(retryCountdownTimer);
  if (elapsedTimer) clearInterval(elapsedTimer);

  const timerBadge = document.getElementById("elapsedTimeBadge");
  if (!timerBadge) return;

  const update = () => {
    const remaining = Math.max(0, Math.ceil((activeUntil - Date.now()) / 1000));
    timerBadge.textContent = `Retrying in ${remaining}s`;
    timerBadge.style.backgroundColor = "rgba(251, 146, 60, 0.15)";
    timerBadge.style.color = "#fb923c";
    timerBadge.style.borderColor = "rgba(251, 146, 60, 0.3)";

    if (remaining <= 0) {
      clearInterval(retryCountdownTimer);
      retryCountdownTimer = null;
    }
  };

  update();
  retryCountdownTimer = setInterval(update, 1000);
}

function stopRetryTimer() {
  if (retryCountdownTimer) {
    clearInterval(retryCountdownTimer);
    retryCountdownTimer = null;
  }
}


// Render search queue items and their operations in the Queue Console tab
function renderQueueConsole() {
  if (!elements.queueConsoleList || !elements.queueConsoleEmptyState) return;

  chrome.storage.local.get(["automationQueue", "isAutomationRunning", "lastSearchStartedAt", "automationLogs", "isQueuePaused", "queuePauseReason", "rateLimitRetryActiveUntil"], (result) => {
    const queue = result.automationQueue || [];
    const isRunning = result.isAutomationRunning || false;
    const lastStarted = result.lastSearchStartedAt || 0;
    const logs = result.automationLogs || [];
    const isPaused = result.isQueuePaused || false;
    const pauseReason = result.queuePauseReason || "";
    const activeUntil = result.rateLimitRetryActiveUntil || 0;
    const isWaitingRetry = activeUntil > Date.now();
    
    elements.statsLabel.textContent = `${queue.length} pending`;
    elements.exportCsvBtn.disabled = true; // No CSV export for queue
    elements.clearAllBtn.disabled = queue.length === 0;

    // Toggle Pause/Resume buttons in header
    if (elements.pauseQueueBtn && elements.forceResumeQueueBtn) {
      if (queue.length === 0) {
        elements.pauseQueueBtn.style.display = "none";
        elements.forceResumeQueueBtn.style.display = "none";
      } else {
        if (isPaused) {
          elements.pauseQueueBtn.style.display = "none";
          elements.forceResumeQueueBtn.style.display = "inline-flex";
          elements.forceResumeQueueBtn.querySelector("span").textContent = "Resume Queue";
        } else {
          elements.pauseQueueBtn.style.display = "inline-flex";
          elements.forceResumeQueueBtn.style.display = "inline-flex";
          elements.forceResumeQueueBtn.querySelector("span").textContent = "Force Resume";
        }
      }
    }

    // Update status card
    if (elements.queueConsoleStatus) {
      if (isPaused) {
        elements.queueConsoleStatus.textContent = pauseReason.includes("Limit") ? "LIMIT PAUSE" : "PAUSED";
        elements.queueConsoleStatus.style.color = "#ef4444"; // red
      } else if (isWaitingRetry) {
        elements.queueConsoleStatus.textContent = "WAIT RETRY";
        elements.queueConsoleStatus.style.color = "#fb923c"; // orange/amber
      } else if (isRunning && queue.length > 0) {
        elements.queueConsoleStatus.textContent = "SEARCHING";
        elements.queueConsoleStatus.style.color = "#f59e0b"; // amber
      } else {
        elements.queueConsoleStatus.textContent = "IDLE";
        elements.queueConsoleStatus.style.color = "#10b981"; // success green
      }
    }

    // Update count card
    if (elements.queueConsoleCount) {
      elements.queueConsoleCount.textContent = queue.length;
    }

    // Update est time card
    if (elements.queueConsoleEstTime) {
      elements.queueConsoleEstTime.textContent = `${queue.length * 15}s`;
    }

    if (queue.length === 0) {
      stopElapsedTimer();
      if (elements.activeSearchSection) elements.activeSearchSection.style.display = "none";
      if (elements.upNextSection) elements.upNextSection.style.display = "none";
      elements.queueConsoleList.style.display = "none";
      elements.queueConsoleEmptyState.style.display = "flex";
      
      const miniLogsSec = document.getElementById("miniLogsSection");
      if (miniLogsSec) miniLogsSec.style.display = "none";
      return;
    }

    elements.queueConsoleEmptyState.style.display = "none";
    const miniLogsSec = document.getElementById("miniLogsSection");
    if (miniLogsSec) miniLogsSec.style.display = "flex";

    // 1. Render Active Search Card
    if (elements.activeSearchSection && elements.activeSearchCard) {
      elements.activeSearchSection.style.display = "flex";
      const activeItem = queue[0];
      
      let avatarHtml = "";
      if (activeItem.avatarUrl) {
        avatarHtml = `<img class="item-avatar" src="${activeItem.avatarUrl}" alt="${activeItem.fullName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`;
      }
      avatarHtml += `<div class="item-avatar-placeholder">${getInitials(activeItem.fullName)}</div>`;

      elements.activeSearchCard.className = "active-search-panel";
      elements.activeSearchCard.innerHTML = `
        <div class="active-card-top" style="display: flex; gap: 12px; align-items: flex-start;">
          <div class="item-avatar-container">${avatarHtml}</div>
          <div class="item-details" style="flex-grow: 1; min-width: 0;">
            <div class="item-title-row">
              <span class="item-title" style="font-size: 13px; font-weight: 700;" title="${activeItem.fullName}">${activeItem.fullName}</span>
              <span id="elapsedTimeBadge" class="elapsed-badge">0s elapsed</span>
            </div>
            <div class="item-subtitle" style="font-size: 11px; margin-top: 1px;">${activeItem.headline || 'LinkedIn Member'}</div>
            <div class="item-meta" style="margin-top: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              <span>${activeItem.companyName || 'Unknown Company'}</span>
            </div>
          </div>
        </div>
        
        <div class="progress-bar-container" style="height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-top: 12px; overflow: hidden; position: relative;">
          <div class="progress-bar-fill" style="position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #6366f1, #a78bfa); width: 100%; transform: translateX(-100%); animation: shimmer-progress 2s infinite ease-in-out;"></div>
        </div>
        
        <div class="active-card-actions" style="margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;">
          <button class="action-btn open-profile-url" data-url="${activeItem.profileUrl}" style="padding: 5px 10px; font-size: 10.5px;">LinkedIn</button>
          <button class="action-btn btn-danger cancel-queue-btn" data-url="${activeItem.profileUrl}" style="padding: 5px 10px; font-size: 10.5px; font-weight: 700;">Cancel Run</button>
        </div>
      `;

      elements.activeSearchCard.querySelector(".open-profile-url").addEventListener("click", () => {
        window.open(activeItem.profileUrl, "_blank");
      });
      elements.activeSearchCard.querySelector(".cancel-queue-btn").addEventListener("click", () => {
        removeQueueItem(activeItem.profileUrl);
      });

      // Handle real-time elapsed timer
      if (isWaitingRetry) {
        startRetryTimer(activeUntil);
      } else if (isRunning && !isPaused) {
        stopRetryTimer();
        const startTime = lastStarted > 0 ? lastStarted : Date.now();
        startElapsedTimer(startTime);
      } else {
        stopRetryTimer();
        stopElapsedTimer();
        const timerBadge = document.getElementById("elapsedTimeBadge");
        if (timerBadge) {
          timerBadge.textContent = isPaused ? (pauseReason.includes("Limit") ? "Rate Limited" : "Paused") : "Starting...";
          timerBadge.style.backgroundColor = isPaused ? "rgba(75, 85, 99, 0.15)" : "rgba(245, 158, 11, 0.15)";
          timerBadge.style.color = isPaused ? "#9ca3af" : "#f59e0b";
          timerBadge.style.borderColor = isPaused ? "rgba(75, 85, 99, 0.3)" : "rgba(245, 158, 11, 0.3)";
        }
      }
    }

    // 2. Render Up Next Queue List
    if (queue.length > 1) {
      if (elements.upNextSection) elements.upNextSection.style.display = "flex";
      elements.queueConsoleList.style.display = "flex";

      const pendingItems = queue.slice(1);
      const cardCreator = (card, item, isUpdate, index) => {
        if (!isUpdate) {
          card.className = "item-card";
          card.style.padding = "8px 10px"; // more compact
          card.innerHTML = `
            <div class="item-avatar-container">
              <div class="item-avatar-placeholder" style="width: 32px; height: 32px; font-size: 11px;">${getInitials(item.fullName)}</div>
            </div>
            <div class="item-details" style="flex-grow: 1; min-width: 0;">
              <div class="item-title-row">
                <span class="item-title" style="font-size: 12px;" title="${item.fullName}">${item.fullName}</span>
                <span class="badge" style="font-size: 9px; background-color: var(--text-muted); color: white; padding: 1px 4px; border-radius: 4px;">Pending</span>
              </div>
              <div class="item-subtitle" style="font-size: 10px;">${item.headline || 'LinkedIn Member'}</div>
              <div class="card-actions" style="margin-top: 4px; display: flex; gap: 6px;">
                <span class="move-top-placeholder"></span>
                <button class="action-btn btn-danger cancel-queue-btn" data-url="${item.profileUrl}" style="padding: 2px 6px; font-size: 9px;">Cancel</button>
                <button class="action-btn open-profile-url" data-url="${item.profileUrl}" style="padding: 2px 6px; font-size: 9px;">LinkedIn</button>
              </div>
            </div>
          `;

          card.querySelector(".cancel-queue-btn").addEventListener("click", () => removeQueueItem(item.profileUrl));
          card.querySelector(".open-profile-url").addEventListener("click", (e) => {
            window.open(e.target.getAttribute("data-url"), "_blank");
          });
        }

        const moveTopPlaceholder = card.querySelector(".move-top-placeholder");
        if (index > 0) {
          const existingMoveTopBtn = moveTopPlaceholder.querySelector(".move-top-btn");
          if (!existingMoveTopBtn) {
            moveTopPlaceholder.innerHTML = `<button class="action-btn move-top-btn" data-url="${item.profileUrl}" style="padding: 2px 6px; font-size: 9px;">Move to Top</button>`;
            const moveTopBtn = moveTopPlaceholder.querySelector(".move-top-btn");
            moveTopBtn.addEventListener("click", () => moveQueueItemToTop(item.profileUrl));
          }
        } else {
          moveTopPlaceholder.innerHTML = "";
        }
      };

      reconcileList(elements.queueConsoleList, pendingItems, cardCreator, item => item.profileUrl);
    } else {
      if (elements.upNextSection) elements.upNextSection.style.display = "none";
      elements.queueConsoleList.style.display = "none";
    }

  });
}

// Remove a profile from the queue and notify LinkedIn content scripts
function removeQueueItem(profileUrl) {
  chrome.storage.local.get({ automationQueue: [], processingUrls: [] }, (result) => {
    let queue = result.automationQueue || [];
    let processing = result.processingUrls || [];

    const isCurrent = queue.length > 0 && queue[0].profileUrl === profileUrl;

    queue = queue.filter(item => item.profileUrl !== profileUrl);
    processing = processing.filter(url => url !== profileUrl);

    const updates = {
      automationQueue: queue,
      processingUrls: processing
    };

    if (isCurrent) {
      updates.isAutomationRunning = false;
      updates.pendingAutomationSearch = null;
    }

    chrome.storage.local.set(updates, () => {
      showToast("Removed profile from queue.");
      notifyLinkedinTabs();
      updateStatusBadge();
      
      if (isCurrent) {
        chrome.runtime.sendMessage({ type: "FORCE_RESUME_QUEUE" });
      }
    });
  });
}

// Move a profile to the top of the queue (position 1, since position 0 is currently active)
function moveQueueItemToTop(profileUrl) {
  chrome.storage.local.get({ automationQueue: [] }, (result) => {
    const queue = result.automationQueue || [];
    if (queue.length <= 1) return;

    const itemIndex = queue.findIndex(item => item.profileUrl === profileUrl);
    if (itemIndex <= 1) return;

    const item = queue[itemIndex];
    queue.splice(itemIndex, 1);
    queue.splice(1, 0, item);

    chrome.storage.local.set({ automationQueue: queue }, () => {
      showToast("Moved to next-in-line.");
      updateStatusBadge();
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Tabs Navigation
  elements.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      elements.tabButtons.forEach(b => b.classList.remove("active"));
      elements.tabViews.forEach(v => v.classList.remove("active"));

      btn.classList.add("active");
      activeTab = btn.getAttribute("data-tab");
      document.getElementById(`tabView-${activeTab}`).classList.add("active");

      if (activeTab !== "queue") {
        stopElapsedTimer();
      }

      if (activeTab === "jobs") {
        runPageExtraction();
        fetchJobs();
      }

      renderUI();
    });
  });

  // Searches
  elements.profileSearch.addEventListener("input", renderProfiles);
  elements.leadSearch.addEventListener("input", renderLeads);

  // Profiles Category Filters
  const filterPills = document.querySelectorAll(".filter-pill");
  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      profilesFilter = pill.getAttribute("data-filter");
      renderProfiles();
    });
  });

  // Leads Category Filters
  const leadsFilterPills = document.querySelectorAll(".leads-filter-pill");
  leadsFilterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      leadsFilterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      leadsFilter = pill.getAttribute("data-filter");
      renderLeads();
    });
  });

  // Clear Buttons
  elements.clearAllBtn.addEventListener("click", handleClear);

  // Export CSV
  elements.exportCsvBtn.addEventListener("click", handleExport);

  // Force Resume Queue from Console
  if (elements.forceResumeQueueBtn) {
    elements.forceResumeQueueBtn.addEventListener("click", () => {
      elements.forceResumeQueueBtn.disabled = true;
      const originalHtml = elements.forceResumeQueueBtn.innerHTML;
      elements.forceResumeQueueBtn.textContent = "Resuming...";
      chrome.runtime.sendMessage({ type: "FORCE_RESUME_QUEUE" }, () => {
        elements.forceResumeQueueBtn.disabled = false;
        elements.forceResumeQueueBtn.innerHTML = originalHtml;
        showToast("Queue resume triggered!");
        loadData();
        updateStatusBadge();
      });
    });
  }

  // Pause Queue manually from Console
  if (elements.pauseQueueBtn) {
    elements.pauseQueueBtn.addEventListener("click", () => {
      elements.pauseQueueBtn.disabled = true;
      chrome.runtime.sendMessage({ type: "PAUSE_QUEUE_MANUALLY" }, () => {
        elements.pauseQueueBtn.disabled = false;
        showToast("Queue paused.");
        loadData();
        updateStatusBadge();
      });
    });
  }

  // External redirects
  elements.goToLinkedinBtn.addEventListener("click", () => {
    window.open("https://www.linkedin.com", "_blank");
  });
  elements.goToMailmeteorBtn.addEventListener("click", () => {
    window.open("https://mailmeteor.com/tools/linkedin-email-finder", "_blank");
  });

  // Listen for background updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "PROFILE_SAVED") {
      loadData();
      updateStatusBadge();
    } else if (message.type === "NEW_LEAD_EXTRACTED") {
      loadData();
      updateStatusBadge();
    } else if (message.type === "NEW_LOG") {
      allLogs.push(message.log);
      appendTerminalLog(message.log);
      updateStatusBadge();
    } else if (message.type === "QUEUE_PAUSED") {
      loadData();
      updateStatusBadge();
    }
  });

  // Storage listener fallback
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pendingAutomationSearch || changes.isQueuePaused || changes.isAutomationRunning) {
      updateStatusBadge();
    }
    if (changes.savedProfiles || changes.extractedLeads || changes.automationQueue) {
      loadData();
    }
  });

  // Save Job Application button click listener
  if (elements.saveJobBtn) {
    elements.saveJobBtn.addEventListener("click", saveJob);
  }

  // Manually re-trigger extraction click listener
  if (elements.extractJobBtn) {
    elements.extractJobBtn.addEventListener("click", runPageExtraction);
  }
}

// Render dynamic elements based on active tab
function renderUI() {
  updateStatusBadge();

  if (activeTab === "profiles") {
    renderProfiles();
  } else if (activeTab === "leads") {
    renderLeads();
  } else if (activeTab === "logs") {
    renderLogs();
  } else if (activeTab === "queue") {
    renderQueueConsole();
  } else if (activeTab === "jobs") {
    renderJobs();
  }
}

// Helper to get initials
function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// TABS 1: Profiles View
function renderProfiles() {
  const searchTerm = elements.profileSearch.value.toLowerCase().trim();
  let filtered = allProfiles.filter(p => 
    p.fullName.toLowerCase().includes(searchTerm) ||
    (p.headline && p.headline.toLowerCase().includes(searchTerm)) ||
    (p.companyName && p.companyName.toLowerCase().includes(searchTerm))
  );

  // Apply Category Filters
  if (profilesFilter === "extracted") {
    filtered = filtered.filter(p => 
      allLeads.some(l => cleanUrl(l.linkedinUrl) === cleanUrl(p.profileUrl))
    );
  } else if (profilesFilter === "in_queue") {
    filtered = filtered.filter(p => 
      allQueue.some(q => cleanUrl(q.profileUrl) === cleanUrl(p.profileUrl))
    );
  } else if (profilesFilter === "retry") {
    filtered = filtered.filter(p => {
      const hasLead = allLeads.some(l => cleanUrl(l.linkedinUrl) === cleanUrl(p.profileUrl));
      const inQueue = allQueue.some(q => cleanUrl(q.profileUrl) === cleanUrl(p.profileUrl));
      return !hasLead && !inQueue;
    });
  }

  elements.statsLabel.textContent = `${filtered.length} shown (${allProfiles.length} total)`;
  elements.exportCsvBtn.disabled = allProfiles.length === 0;
  elements.clearAllBtn.disabled = allProfiles.length === 0;

  if (filtered.length === 0) {
    elements.profilesList.style.display = "none";
    elements.profilesEmptyState.style.display = "flex";
    if (searchTerm || profilesFilter !== "all") {
      document.getElementById("profileEmptyTitle").textContent = "No Matches Found";
      document.getElementById("profileEmptyText").textContent = `No saved profiles match the current filters or search term "${searchTerm}"`;
      elements.goToLinkedinBtn.style.display = "none";
    } else {
      document.getElementById("profileEmptyTitle").textContent = "No Saved Profiles";
      document.getElementById("profileEmptyText").innerHTML = `Navigate to a LinkedIn company page, go to the <strong>People</strong> tab, and click <strong>Save & Find Email</strong> to start.`;
      elements.goToLinkedinBtn.style.display = "block";
    }
    return;
  }

  elements.profilesEmptyState.style.display = "none";
  elements.profilesList.style.display = "flex";

  // Sort descending by saved date
  const sorted = [...filtered].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  const cardCreator = (card, p, isUpdate, index) => {
    if (!isUpdate) {
      let avatarHtml = "";
      if (p.avatarUrl) {
        avatarHtml = `<img class="item-avatar" src="${p.avatarUrl}" alt="${p.fullName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`;
      }
      avatarHtml += `<div class="item-avatar-placeholder">${getInitials(p.fullName)}</div>`;

      card.className = "item-card";
      card.innerHTML = `
        <div class="item-avatar-container">${avatarHtml}</div>
        <div class="item-details">
          <div class="item-title-row">
            <span class="item-title" title="${p.fullName}">${p.fullName}</span>
            <div style="display: flex; gap: 4px; align-items: center;">
              <span class="badge badge-indigo">${p.degree || '2nd'}</span>
              <span class="lead-badge-placeholder"></span>
            </div>
          </div>
          <div class="item-subtitle">${p.headline || 'LinkedIn Member'}</div>
          ${p.companyName ? `
            <div class="item-meta">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
              </svg>
              <span>${p.companyName}</span>
            </div>` : ""}
          <div class="card-actions">
            <span class="retry-btn-placeholder"></span>
            <button class="action-btn copy-profile-url" data-url="${p.profileUrl}">Copy URL</button>
            <button class="action-btn open-profile-url" data-url="${p.profileUrl}">Open Profile</button>
            <button class="action-btn btn-danger delete-profile" data-id="${p.id}">Remove</button>
          </div>
        </div>
      `;

      card.querySelector(".copy-profile-url").addEventListener("click", (e) => {
        copyToClipboard(e.target.getAttribute("data-url"));
      });
      card.querySelector(".open-profile-url").addEventListener("click", (e) => {
        window.open(e.target.getAttribute("data-url"), "_blank");
      });
      card.querySelector(".delete-profile").addEventListener("click", (e) => {
        deleteProfile(e.target.getAttribute("data-id"));
      });
    }

    const hasLead = allLeads.some(l => cleanUrl(l.linkedinUrl) === cleanUrl(p.profileUrl));
    const inQueue = allQueue.some(q => cleanUrl(q.profileUrl) === cleanUrl(p.profileUrl));

    const leadBadgeContainer = card.querySelector(".lead-badge-placeholder");
    const retryBtnContainer = card.querySelector(".retry-btn-placeholder");

    if (hasLead) {
      leadBadgeContainer.innerHTML = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--success-color); border: 1px solid rgba(16, 185, 129, 0.2); margin-left: 4px;">Extracted</span>`;
      retryBtnContainer.innerHTML = "";
    } else {
      leadBadgeContainer.innerHTML = "";
      if (inQueue) {
        retryBtnContainer.innerHTML = `<button class="action-btn in-queue-btn" style="background-color: rgba(245, 158, 11, 0.12); color: #f59e0b; border-color: rgba(245, 158, 11, 0.25); cursor: not-allowed;" disabled>In Queue...</button>`;
      } else {
        const existingRetryBtn = retryBtnContainer.querySelector(".retry-search-btn");
        if (!existingRetryBtn) {
          retryBtnContainer.innerHTML = `<button class="action-btn retry-search-btn" style="background-color: rgba(99, 102, 241, 0.15); color: var(--accent-color); border-color: rgba(99, 102, 241, 0.25);" data-id="${p.id}">Retry Search</button>`;
          const retryBtn = retryBtnContainer.querySelector(".retry-search-btn");
          retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            retrySearch(p);
          });
        }
      }
    }
  };

  reconcileList(elements.profilesList, sorted, cardCreator, p => p.id);
}

// Re-add a profile back to the background automation queue
function retrySearch(profile) {
  showToast(`Added ${profile.fullName} to search queue.`);
  allQueue.push(profile);
  renderProfiles();
  
  chrome.runtime.sendMessage({
    type: "START_AUTOMATION",
    profile: profile
  }, () => {
    loadData();
  });
}

// TABS 2: Leads View
function renderLeads() {
  const searchTerm = elements.leadSearch.value.toLowerCase().trim();

  // First apply text search
  let filtered = allLeads.filter(l =>
    l.fullName.toLowerCase().includes(searchTerm) ||
    l.companyName.toLowerCase().includes(searchTerm) ||
    l.email.toLowerCase().includes(searchTerm) ||
    (l.headline && l.headline.toLowerCase().includes(searchTerm))
  );

  // Apply category filter
  if (leadsFilter === "saved") {
    filtered = filtered.filter(l => l.syncedToDb === true);
  } else if (leadsFilter === "unsaved") {
    filtered = filtered.filter(l => !l.syncedToDb);
  }

  // Stats label: show filtered/total when a filter is active
  const hasActiveFilter = searchTerm || leadsFilter !== "all";
  if (hasActiveFilter) {
    elements.statsLabel.textContent = `${filtered.length} shown (${allLeads.length} total)`;
  } else {
    elements.statsLabel.textContent = `${allLeads.length} lead${allLeads.length === 1 ? "" : "s"}`;
  }
  elements.exportCsvBtn.disabled = allLeads.length === 0;
  elements.clearAllBtn.disabled = allLeads.length === 0;

  if (filtered.length === 0) {
    elements.leadsList.style.display = "none";
    elements.leadsEmptyState.style.display = "flex";
    if (searchTerm || leadsFilter !== "all") {
      elements.leadsEmptyState.querySelector("h3").textContent = "No Matches Found";
      elements.leadsEmptyState.querySelector("p").textContent =
        leadsFilter === "saved"
          ? "No leads have been saved to the database yet."
          : leadsFilter === "unsaved"
          ? "All extracted leads have already been saved to the database."
          : `No extracted leads match "${searchTerm}"`;
      elements.goToMailmeteorBtn.style.display = "none";
    } else {
      elements.leadsEmptyState.querySelector("h3").textContent = "No Leads Extracted";
      elements.leadsEmptyState.querySelector("p").textContent = "Save profiles on LinkedIn and we'll automatically query them on Mailmeteor and save results here.";
      elements.goToMailmeteorBtn.style.display = "block";
    }
    return;
  }

  elements.leadsEmptyState.style.display = "none";
  elements.leadsList.style.display = "flex";

  const cardCreator = (card, l, isUpdate, index) => {
    if (!isUpdate) {
      const statusClass = `status-chip-${l.status.replace(/\s+/g, "").toLowerCase()}`;
      card.className = "item-card";
      card.innerHTML = `
        <div class="item-avatar-container">
          <div class="item-avatar-placeholder">${getInitials(l.fullName)}</div>
        </div>
        <div class="item-details">
          <div class="item-title-row">
            <span class="item-title" title="${l.fullName}">${l.fullName}</span>
            <span class="status-chip ${statusClass}">${l.status}</span>
          </div>
          <div class="item-subtitle">${l.headline || 'Professional'}</div>
          
          <div class="lead-data-block">
            <div class="lead-data-item">
              <span class="lead-label">Company:</span>
              <span class="lead-value">${l.companyName}</span>
            </div>
            <div class="lead-data-item">
              <span class="lead-label">Email:</span>
              <span class="lead-value font-monospace select-text">${l.email}</span>
            </div>
          </div>

          <div class="lead-tags-container" style="margin-top: 6px;"></div>

          <div class="card-actions">
            <span class="sync-db-placeholder"></span>
            <button class="action-btn copy-email" data-email="${l.email}">Copy Email</button>
            ${l.linkedinUrl ? `<button class="action-btn open-profile-url" data-url="${l.linkedinUrl}">LinkedIn</button>` : ""}
            <button class="action-btn btn-danger delete-lead" data-id="${l.id}">Delete</button>
          </div>
        </div>
      `;

      card.querySelector(".copy-email").addEventListener("click", (e) => {
        copyToClipboard(e.target.getAttribute("data-email"), "Email copied!");
      });
      if (l.linkedinUrl) {
        card.querySelector(".open-profile-url").addEventListener("click", (e) => {
          window.open(e.target.getAttribute("data-url"), "_blank");
        });
      }
      card.querySelector(".delete-lead").addEventListener("click", (e) => {
        deleteLead(e.target.getAttribute("data-id"));
      });
    }

    const isSynced = l.syncedToDb || false;
    const tagsContainer = card.querySelector(".lead-tags-container");
    if (tagsContainer) {
      if (isSynced) {
        if (l.tags && l.tags.length > 0) {
          tagsContainer.style.display = "block";
          tagsContainer.innerHTML = `
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${l.tags.map(t => `<span class="static-tag-badge">${t}</span>`).join("")}
            </div>
          `;
        } else {
          tagsContainer.style.display = "none";
          tagsContainer.innerHTML = "";
        }
      } else {
        tagsContainer.style.display = "block";
        if (!tagsContainer.querySelector(".lead-tags-input")) {
          tagsContainer.innerHTML = `
            <input type="text" class="lead-tags-input" placeholder="Add tags (comma-separated)..." value="${l.tags ? l.tags.join(', ') : ''}" style="width: 100%; background: rgba(15, 23, 42, 0.4); border: 1px solid var(--panel-border); color: var(--text-primary); padding: 4px 8px; border-radius: 4px; font-size: 10.5px; outline: none; border-color: var(--panel-border);">
          `;
          const input = tagsContainer.querySelector(".lead-tags-input");
          input.addEventListener("input", (e) => {
            const tagsArray = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
            l.tags = tagsArray;
            chrome.storage.local.get({ extractedLeads: [] }, (result) => {
              const list = result.extractedLeads || [];
              const idx = list.findIndex(item => item.id === l.id);
              if (idx !== -1) {
                list[idx].tags = tagsArray;
                chrome.storage.local.set({ extractedLeads: list });
              }
            });
          });
        }
      }
    }

    const syncPlaceholder = card.querySelector(".sync-db-placeholder");
    const existingSyncBtn = syncPlaceholder.querySelector(".action-btn");
    
    const expectedText = isSynced ? "Saved to DB" : "Save to DB";
    const expectedClass = isSynced ? "action-btn btn-success" : "action-btn sync-db-btn";
    const expectedDisabled = isSynced;
    
    if (!existingSyncBtn) {
      const btn = document.createElement("button");
      btn.className = expectedClass;
      btn.textContent = expectedText;
      btn.disabled = expectedDisabled;
      btn.setAttribute("data-id", l.id);
      if (!isSynced) {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          syncLeadToDb(l.id, btn);
        });
      }
      syncPlaceholder.appendChild(btn);
    } else {
      if (existingSyncBtn.textContent === "Saving..." && !isSynced) {
        // Keep "Saving..." state during sync
      } else {
        if (existingSyncBtn.textContent !== expectedText) {
          existingSyncBtn.textContent = expectedText;
        }
        if (existingSyncBtn.className !== expectedClass) {
          existingSyncBtn.className = expectedClass;
        }
        if (existingSyncBtn.disabled !== expectedDisabled) {
          existingSyncBtn.disabled = expectedDisabled;
        }
      }
    }
  };

  reconcileList(elements.leadsList, filtered, cardCreator, l => l.id);
}

// TABS 3: Activity Logs View
function renderLogs() {
  elements.statsLabel.textContent = `${allLogs.length} events`;
  elements.exportCsvBtn.disabled = true; // No CSV export for logs needed
  elements.clearAllBtn.disabled = allLogs.length === 0;

  elements.terminalBody.innerHTML = "";
  if (allLogs.length === 0) {
    elements.terminalBody.innerHTML = `<div class="terminal-row system-msg">System initialized. Awaiting automation triggers...</div>`;
    return;
  }

  allLogs.forEach(log => {
    appendTerminalLog(log);
  });
}

function appendTerminalLog(log) {
  if (activeTab !== "logs" && elements.terminalBody.children.length === 0) {
    // If we're not on the logs tab, don't bother rendering, it will load on tab switch
    return;
  }
  const row = document.createElement("div");
  row.className = "terminal-row";
  
  // Highlight search successes or captcha alerts
  if (log.message.includes("Successfully")) {
    row.classList.add("success-msg");
  } else if (log.message.includes("CAPTCHA") || log.message.includes("warning")) {
    row.classList.add("warning-msg");
  } else if (log.message.includes("No open") || log.message.includes("finished")) {
    row.classList.add("system-msg");
  }

  row.innerHTML = `<span class="timestamp">[${log.timestamp}]</span> <span class="message">${log.message}</span>`;
  elements.terminalBody.appendChild(row);
  elements.terminalBody.scrollTop = elements.terminalBody.scrollHeight;
}

// Deletes
function deleteProfile(id) {
  chrome.storage.local.get({ savedProfiles: [] }, (result) => {
    const list = result.savedProfiles || [];
    const updated = list.filter(p => p.id !== id);
    chrome.storage.local.set({ savedProfiles: updated }, () => {
      allProfiles = updated;
      renderProfiles();
      showToast("Profile removed");
      notifyLinkedinTabs();
    });
  });
}

function deleteLead(id) {
  chrome.storage.local.get({ extractedLeads: [] }, (result) => {
    const list = result.extractedLeads || [];
    const updated = list.filter(l => l.id !== id);
    chrome.storage.local.set({ extractedLeads: updated }, () => {
      allLeads = updated;
      renderLeads();
      showToast("Lead deleted");
    });
  });
}

// Clear Actions
function handleClear() {
  if (activeTab === "profiles") {
    if (confirm("Are you sure you want to clear all saved profiles?")) {
      chrome.storage.local.set({ savedProfiles: [] }, () => {
        allProfiles = [];
        renderProfiles();
        showToast("Profiles cleared");
        notifyLinkedinTabs();
      });
    }
  } else if (activeTab === "leads") {
    if (confirm("Are you sure you want to clear all extracted leads?")) {
      chrome.storage.local.set({ extractedLeads: [] }, () => {
        allLeads = [];
        renderLeads();
        showToast("Leads cleared");
      });
    }
  } else if (activeTab === "logs") {
    if (confirm("Are you sure you want to clear the activity log?")) {
      chrome.storage.local.set({ automationLogs: [] }, () => {
        allLogs = [];
        renderLogs();
        showToast("Logs cleared");
      });
    }
  } else if (activeTab === "queue") {
    if (confirm("Are you sure you want to cancel all pending items in the search queue?")) {
      chrome.storage.local.set({ automationQueue: [], processingUrls: [], isAutomationRunning: false, pendingAutomationSearch: null }, () => {
        showToast("Queue cleared");
        notifyLinkedinTabs();
        loadData();
        updateStatusBadge();
      });
    }
  }
}

// Export CSV Actions
function handleExport() {
  if (activeTab === "profiles") {
    exportProfilesCsv();
  } else if (activeTab === "leads") {
    exportLeadsCsv();
  }
}

function exportProfilesCsv() {
  if (allProfiles.length === 0) return;
  const esc = (s) => `"${(s || "").replace(/"/g, '""')}"`;
  const headers = ["Name", "Headline", "Degree", "Company", "Profile URL", "Mutual Info", "Saved At"];
  const rows = allProfiles.map(p => [
    esc(p.fullName), esc(p.headline), esc(p.degree), esc(p.companyName), esc(p.profileUrl), esc(p.mutualInfo), esc(p.savedAt)
  ]);
  downloadCsv(headers, rows, "saved_linkedin_profiles.csv");
}

function exportLeadsCsv() {
  if (allLeads.length === 0) return;
  const esc = (s) => `"${(s || "").replace(/"/g, '""')}"`;
  const headers = ["Name", "Email", "Company", "Job Title", "LinkedIn URL", "Status", "Extracted At"];
  const rows = allLeads.map(l => [
    esc(l.fullName), esc(l.email), esc(l.companyName), esc(l.headline), esc(l.linkedinUrl), esc(l.status), esc(l.extractedAt)
  ]);
  downloadCsv(headers, rows, "extracted_mailmeteor_leads.csv");
}

function downloadCsv(headers, rows, filename) {
  const content = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Copy to Clipboard helper
function copyToClipboard(text, successMsg = "Copied to clipboard!") {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg);
  }).catch(err => {
    console.error("Copy failed:", err);
  });
}

function showToast(message) {
  elements.internalToast.textContent = message;
  elements.internalToast.classList.add("show");
  setTimeout(() => {
    elements.internalToast.classList.remove("show");
  }, 2000);
}

// Notify LinkedIn tabs to reload buttons when a deletion occurs
async function notifyLinkedinTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.url && t.url.includes("linkedin.com")) {
        chrome.tabs.sendMessage(t.id, { type: "REFRESH_SAVED_PROFILES" }).catch(() => {});
      }
    }
  } catch (err) {}
}

// Sync Lead to Fastify DB with skipBounceMonitor: true
function syncLeadToDb(id, button) {
  button.disabled = true;
  button.textContent = "Saving...";

  chrome.storage.local.get({ extractedLeads: [] }, (result) => {
    const list = result.extractedLeads || [];
    const leadIndex = list.findIndex(l => l.id === id);
    if (leadIndex === -1) {
      showToast("Lead not found locally");
      renderLeads();
      return;
    }

    const lead = list[leadIndex];

    fetch(`${BACKEND_URL}/leads/extension-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fullName: lead.fullName,
        email: lead.email,
        companyName: lead.companyName,
        headline: lead.headline || null,
        linkedinUrl: lead.linkedinUrl || null,
        status: "pre_verified",
        skipBounceMonitor: true,
        tags: lead.tags || []
      })
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(data => { throw new Error(data.message || "DB write error"); });
      }
      return res.json();
    })
    .then(data => {
      if (data.success) {
        showToast("Lead saved to Database!");
        list[leadIndex].syncedToDb = true;
        chrome.storage.local.set({ extractedLeads: list }, () => {
          allLeads = list;
          renderLeads();
        });
      } else {
        alert(`Sync failed: ${data.message || "Failed to import lead."}`);
        button.disabled = false;
        button.textContent = "Save to DB";
      }
    })
    .catch(err => {
      alert(`Sync error (backend offline?): ${err.message}`);
      button.disabled = false;
      button.textContent = "Save to DB";
    });
  });
}

// ==========================================
// TABS 5: Job Application Tracker Logic
// ==========================================

function runPageExtraction() {
  if (!chrome.tabs || !chrome.scripting) {
    console.error("Chrome tabs or scripting API not available");
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
      console.warn("Could not query active tab:", chrome.runtime.lastError);
      return;
    }
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    // Prefill URL
    if (elements.jobLinkInput) {
      elements.jobLinkInput.value = tab.url;
    }

    // Skip Chrome internal or extension pages
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
      if (elements.jobRoleInput) elements.jobRoleInput.value = "";
      if (elements.jobCompanyInput) elements.jobCompanyInput.value = "";
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        let role = "";
        let company = "";
        const url = window.location.href;
        const host = window.location.hostname.toLowerCase();

        // Host specific selectors
        if (host.includes("linkedin.com")) {
          const roleEl = document.querySelector(".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .jobs-details-speaker-single-line-and-panel__job-title, h1.t-24, h1");
          const companyEl = document.querySelector(".job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name, .jobs-details-speaker-single-line-and-panel__company-name, .job-details-jobs-unified-top-card__company-name");
          role = roleEl ? roleEl.textContent : "";
          company = companyEl ? companyEl.textContent : "";
        } else if (host.includes("indeed.com")) {
          const roleEl = document.querySelector("h1.jobsearch-JobInfoHeader-title, [data-testid='simpler-job-title']");
          const companyEl = document.querySelector("div[data-company-name='true'] a, div[data-company-name='true'], .jobsearch-InlineCompanyRating");
          role = roleEl ? roleEl.textContent : "";
          company = companyEl ? companyEl.textContent : "";
        } else if (host.includes("greenhouse.io")) {
          const roleEl = document.querySelector("h1.app-title, .header-container h1");
          const companyEl = document.querySelector("span.company-name, .company-name");
          role = roleEl ? roleEl.textContent : "";
          company = companyEl ? companyEl.textContent : "";
        } else if (host.includes("lever.co")) {
          const roleEl = document.querySelector(".posting-header h2");
          const pathParts = window.location.pathname.split("/").filter(Boolean);
          if (pathParts.length > 0) {
            company = pathParts[0];
          }
          role = roleEl ? roleEl.textContent : "";
        }

        // Generic fallback parsing title or meta
        if (!role || !company) {
          const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
          const ogSite = document.querySelector('meta[property="og:site_name"]')?.content;
          const author = document.querySelector('meta[name="author"]')?.content;

          const title = ogTitle || document.title;
          
          if (title) {
            let cleanTitle = title.replace(/\|.*$/g, "").replace(/\-.*$/g, "").trim();
            if (title.includes(" at ")) {
              const parts = title.split(" at ");
              if (!role) role = parts[0].trim();
              if (!company) company = parts[1].replace(/\|.*$/, "").replace(/\-.*$/, "").trim();
            } else if (title.includes(" hiring ")) {
              const parts = title.split(" hiring ");
              if (!company) company = parts[0].trim();
              if (!role) role = parts[1].replace(/\|.*$/, "").replace(/\-.*$/, "").trim();
            } else {
              if (!role) role = cleanTitle;
            }
          }
          
          if (!company && ogSite) company = ogSite;
          if (!company && author) company = author;
        }

        const cleanStr = (str) => {
          if (!str) return "";
          return str.replace(/[\r\n\t]+/g, " ").replace(/\s\s+/g, " ").trim();
        };

        return {
          role: cleanStr(role),
          company: cleanStr(company)
        };
      }
    }, (results) => {
      if (chrome.runtime.lastError || !results || results.length === 0) {
        console.warn("Execute script failed:", chrome.runtime.lastError);
        return;
      }
      const extracted = results[0].result;
      if (extracted) {
        if (extracted.role && elements.jobRoleInput) {
          elements.jobRoleInput.value = extracted.role;
        }
        if (extracted.company && elements.jobCompanyInput) {
          let comp = extracted.company;
          if (comp && !comp.includes(" ") && comp === comp.toLowerCase()) {
            comp = comp.charAt(0).toUpperCase() + comp.slice(1);
          }
          elements.jobCompanyInput.value = comp;
        }
      }
    });
  });
}

function fetchJobs() {
  fetch(`${BACKEND_URL}/admin/applications`)
    .then(res => {
      if (!res.ok) throw new Error("Failed to load jobs");
      return res.json();
    })
    .then(jobs => {
      allJobs = jobs || [];
      renderJobs();
    })
    .catch(err => {
      console.error("fetchJobs error:", err);
      renderJobs();
    });
}

function saveJob() {
  const role = elements.jobRoleInput.value.trim();
  const companyName = elements.jobCompanyInput.value.trim();
  const jobLink = elements.jobLinkInput.value.trim();

  if (!role) {
    showToast("Role Name is required.");
    return;
  }
  if (!companyName) {
    showToast("Company Name is required.");
    return;
  }

  elements.saveJobBtn.disabled = true;
  const btnSpan = elements.saveJobBtn.querySelector("span");
  const originalText = btnSpan.textContent;
  btnSpan.textContent = "Saving...";

  fetch(`${BACKEND_URL}/admin/applications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      role,
      companyName,
      jobLink: jobLink || null,
      jobId: null
    })
  })
  .then(res => {
    if (!res.ok) {
      return res.json().then(data => { throw new Error(data.message || "Failed to save application"); });
    }
    return res.json();
  })
  .then(data => {
    showToast("Application saved successfully!");
    elements.jobRoleInput.value = "";
    elements.jobCompanyInput.value = "";
    fetchJobs();
  })
  .catch(err => {
    console.error("Save error:", err);
    showToast(err.message || "Failed to save job application", "error");
  })
  .finally(() => {
    elements.saveJobBtn.disabled = false;
    btnSpan.textContent = originalText;
  });
}

function deleteJob(id) {
  if (!confirm("Are you sure you want to delete this application?")) return;

  fetch(`${BACKEND_URL}/admin/applications/${id}`, {
    method: "DELETE"
  })
  .then(res => {
    if (!res.ok) throw new Error("Failed to delete application");
    return res.json();
  })
  .then(() => {
    showToast("Application deleted.");
    fetchJobs();
  })
  .catch(err => {
    console.error("Delete error:", err);
    showToast(err.message || "Failed to delete application", "error");
  });
}

function renderJobs() {
  if (!elements.jobsList || !elements.jobsEmptyState) return;

  elements.statsLabel.textContent = `${allJobs.length} applications`;
  elements.exportCsvBtn.disabled = true;
  elements.clearAllBtn.disabled = true;

  if (allJobs.length === 0) {
    elements.jobsList.style.display = "none";
    elements.jobsEmptyState.style.display = "flex";
    return;
  }

  elements.jobsEmptyState.style.display = "none";
  elements.jobsList.style.display = "flex";

  const sorted = [...allJobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const cardCreator = (card, item, isUpdate, index) => {
    if (!isUpdate) {
      card.className = "item-card";
      card.innerHTML = `
        <div class="item-avatar-placeholder" style="width: 36px; height: 36px; font-size: 12px; flex-shrink: 0; background: linear-gradient(135deg, rgba(167, 139, 250, 0.25), rgba(139, 92, 246, 0.25)); border: 1px solid rgba(167, 139, 250, 0.3); display: flex; align-items: center; justify-content: center; font-weight: 700; border-radius: 50%; color: var(--text-primary);">
          ${getInitials(item.companyName)}
        </div>
        <div class="item-details" style="flex-grow: 1; min-width: 0;">
          <div class="item-title-row" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="item-title" style="font-size: 13px; font-weight: 600;" title="${item.role}">${item.role}</span>
            <span class="job-status-badge">${item.status}</span>
          </div>
          <div class="item-subtitle" style="font-size: 11px; color: var(--text-secondary);">${item.companyName}</div>
          <div class="card-actions" style="margin-top: 6px; display: flex; gap: 6px;">
            ${item.jobLink ? `
              <button class="action-btn open-job-link" data-url="${item.jobLink}" style="padding: 2px 6px; font-size: 9px; display: flex; align-items: center; gap: 2px;">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span>Link</span>
              </button>` : ""}
            <button class="action-btn btn-danger delete-job-btn" data-id="${item.id}" style="padding: 2px 6px; font-size: 9px;">Delete</button>
          </div>
        </div>
      `;

      const linkBtn = card.querySelector(".open-job-link");
      if (linkBtn) {
        linkBtn.addEventListener("click", () => {
          window.open(item.jobLink, "_blank");
        });
      }

      card.querySelector(".delete-job-btn").addEventListener("click", () => {
        deleteJob(item.id);
      });
    } else {
      const statusBadge = card.querySelector(".job-status-badge");
      if (statusBadge) statusBadge.textContent = item.status;
      const titleSpan = card.querySelector(".item-title");
      if (titleSpan) titleSpan.textContent = item.role;
      const subTitleDiv = card.querySelector(".item-subtitle");
      if (subTitleDiv) subTitleDiv.textContent = item.companyName;
    }
  };

  reconcileList(elements.jobsList, sorted, cardCreator, item => item.id);
}
