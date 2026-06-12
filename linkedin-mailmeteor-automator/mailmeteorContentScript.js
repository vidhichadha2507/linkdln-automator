(() => {
  if (window.__mailmeteorLeadExtractorLoaded) {
    return;
  }
  window.__mailmeteorLeadExtractorLoaded = true;

  // Track already processed emails in this session to prevent double triggers
  const processedEmails = new Set();
  let isAutomatedSearch = false;
  let pendingUrl = null;
  let captchaLogged = false;
  let searchStartTime = 0;
  let watchdogTimeout = null;
  let pollInterval = null;

  // Helper to send logs to the background script
  function logAutomation(message) {
    chrome.runtime.sendMessage({ type: "LOG", message }).catch(() => {});
  }

  // Helper to clean URL
  function cleanUrl(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, "");
    } catch (e) {
      return url.toLowerCase().trim().replace(/\/+$/, "");
    }
  }

  // Stop automation and clear watchdog / poll timers
  function stopAutomation() {
    isAutomatedSearch = false;
    if (watchdogTimeout) {
      clearTimeout(watchdogTimeout);
      watchdogTimeout = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // Start the watchdog timer (8s inactivity check, up to 20s max if skeleton is active)
  function startWatchdog() {
    if (watchdogTimeout) clearTimeout(watchdogTimeout);
    watchdogTimeout = setTimeout(() => {
      if (isAutomatedSearch) {
        const resultsSection = document.getElementById("linkedin-email-finder-results");
        const hasSkeleton = resultsSection?.querySelector(".skeleton-loader");
        const totalElapsed = Date.now() - searchStartTime;

        if (hasSkeleton && totalElapsed < 20000) {
          // Mailmeteor is actively searching and has not exceeded the 20s absolute limit
          logAutomation(`Mailmeteor is still processing... extending search check.`);
          startWatchdog();
          return;
        }

        const reason = totalElapsed >= 20000 
          ? "Search timeout (20s max limit exceeded)" 
          : "Search timeout (8s inactivity)";

        logAutomation(`Watchdog warning: ${reason}. Skipping...`);
        chrome.runtime.sendMessage({
          type: "AUTOMATION_FAILED",
          profileUrl: pendingUrl,
          reason: reason
        }).catch(() => {});
        stopAutomation();
      }
    }, 8000);
  }

  function checkRateLimit() {
    const bodyText = document.body.innerText.toLowerCase();
    const limitKeywords = [
      "limit reached",
      "daily limit",
      "rate limit",
      "rate_limit",
      "too many requests",
      "upgrade your plan",
      "upgrade plan",
      "upgrade to premium",
      "reached your limit",
      "quota exceeded",
      "at capacity"
    ];
    
    for (const kw of limitKeywords) {
      if (bodyText.includes(kw)) {
        return true;
      }
    }
    return false;
  }

  // Initialize Observer
  let throttleTimeout = null;
  function initObserver() {
    checkResults();

    const observer = new MutationObserver(() => {
      if (!throttleTimeout) {
        throttleTimeout = setTimeout(() => {
          checkResults();
          throttleTimeout = null;
        }, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Check if a CAPTCHA is actively blocking
  function checkCaptcha() {
    const captchaEl = document.getElementById("cloudflare-captcha");
    if (captchaEl && captchaEl.querySelector("iframe")) {
      if (!captchaLogged) {
        logAutomation("Cloudflare CAPTCHA detected. Please solve it in the tab to resume search.");
        captchaLogged = true;
      }
      return true;
    }
    captchaLogged = false;
    return false;
  }

  // Scrape and extract leads
  function checkResults() {
    const resultsSection = document.getElementById("linkedin-email-finder-results");
    if (!resultsSection) return;

    if (checkCaptcha()) {
      // If CAPTCHA is active, defer the watchdog timer to give the user time to solve it
      if (isAutomatedSearch) {
        startWatchdog();
      }
      return;
    }

    if (isAutomatedSearch && checkRateLimit()) {
      logAutomation(`Mailmeteor rate limit detected. Pausing automation queue without discarding profile.`);
      chrome.runtime.sendMessage({
        type: "AUTOMATION_RATELIMIT",
        profileUrl: pendingUrl,
        reason: "Mailmeteor Rate Limit / Quota Reached"
      }).catch(() => {});
      stopAutomation();
      return;
    }

    const cards = resultsSection.querySelectorAll(".email-result-card");
    const hasSkeleton = resultsSection.querySelector(".skeleton-loader");

    if (cards.length > 0) {
      // Results are loaded
      cards.forEach((card) => {
        const lead = extractLeadFromCard(card);
        if (!lead) return;

        // Inject inline extract button (independent of auto-save)
        injectExtractButton(card, lead);

        // Auto-save if it's an automated run
        if (isAutomatedSearch) {
          const leadKey = lead.email.toLowerCase();
          if (!processedEmails.has(leadKey)) {
            processedEmails.add(leadKey);
            saveLeadToStorage(lead, true);
          }
        }
      });
    } else if (!hasSkeleton && cards.length === 0 && isAutomatedSearch) {
      // Safeguard: Only trigger failure if we've waited at least 3 seconds for search to start.
      // This prevents premature "no result" failures during page load.
      const elapsed = Date.now() - searchStartTime;
      if (elapsed < 3000) {
        return;
      }

      // Finished loading, but no cards found (e.g. no email found)
      logAutomation(`Mailmeteor finished search: No email address could be found for this profile.`);
      
      // Notify background queue of failure
      chrome.runtime.sendMessage({
        type: "AUTOMATION_FAILED",
        profileUrl: pendingUrl,
        reason: "No email found"
      }).catch(() => {});

      stopAutomation();
    }
  }

  // Find the LinkedIn Profile URL input from the page
  function findLinkedinUrlOnPage() {
    const inputs = Array.from(document.querySelectorAll("input"));
    for (const input of inputs) {
      const value = input.value?.trim() || "";
      if (value.includes("linkedin.com/in/")) {
        return value;
      }
    }
    const finderInput = document.querySelector('input[type="url"], input[type="text"]');
    if (finderInput && finderInput.value?.trim()) {
      const val = finderInput.value.trim();
      if (val.includes("linkedin.com/in/")) {
        return val;
      }
    }
    return "";
  }

  // Extract lead data from card
  function extractLeadFromCard(card) {
    const emailEl = card.querySelector("span.linkedin-email-finder__text.text-secondary");
    const email = emailEl ? emailEl.textContent.trim() : "";

    if (!email) return null;

    const nameEl = card.querySelector("h5.linkedin-email-finder__text span.text-capitalize") || 
                   card.querySelector("h5.linkedin-email-finder__text");
    const fullName = nameEl ? nameEl.textContent.trim().replace(/\s+/g, " ") : "Unknown Contact";

    const companyImg = card.querySelector(".position-text img.linkedin-email-finder-icon") || 
                       card.querySelector(".position-text img");
    let companyName = companyImg ? companyImg.getAttribute("alt")?.trim() : "";

    const titleEl = card.querySelector(".position-text span");
    let headline = titleEl ? titleEl.textContent.trim().replace(/\s+/g, " ") : "";

    const positionTextEl = card.querySelector(".position-text");
    if (positionTextEl) {
      const titleAttr = positionTextEl.getAttribute("data-original-title") || 
                        positionTextEl.getAttribute("title") || "";
      if (titleAttr) {
        const atIndex = titleAttr.lastIndexOf(" at ");
        if (atIndex !== -1) {
          if (!companyName) companyName = titleAttr.substring(atIndex + 4).trim();
          if (!headline) headline = titleAttr.substring(0, atIndex).trim();
        } else if (!headline) {
          headline = titleAttr.trim();
        }
      }
    }

    if (!companyName && headline) {
      const parts = headline.split(/\s+at\s+/i);
      if (parts.length > 1) {
        headline = parts[0].trim();
        companyName = parts[1].trim();
      }
    }

    const statusEl = card.querySelector(".chip");
    let status = "unknown";
    if (statusEl) {
      const clone = statusEl.cloneNode(true);
      const iconSpan = clone.querySelector(".chip__icon");
      if (iconSpan) iconSpan.remove();
      status = clone.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    }

    const currentUrl = findLinkedinUrlOnPage();

    return {
      id: email + "_" + Date.now(),
      fullName,
      email,
      companyName: companyName || "Unknown Company",
      headline: headline || "Professional",
      linkedinUrl: currentUrl || pendingUrl || "",
      status: status || "unknown",
      extractedAt: new Date().toISOString()
    };
  }

  // Inject inline Save/Extract button
  function injectExtractButton(card, lead) {
    const copyBtn = card.querySelector("#copyEmailBtn") || 
                    card.querySelector(".linkedin-email-finder__copy-btn")?.closest("button");
    const container = copyBtn ? copyBtn.parentElement : null;
    if (!container) return;

    const existingBtn = card.querySelector(".mailmeteor-injected-extract-btn");
    if (existingBtn) {
      if (existingBtn.getAttribute("data-bound-email") !== lead.email.toLowerCase()) {
        existingBtn.remove();
      } else {
        return;
      }
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mailmeteor-injected-extract-btn";
    btn.setAttribute("data-bound-email", lead.email.toLowerCase());
    
    Object.assign(btn.style, {
      margin: "0 0 0 10px",
      padding: "5px 12px",
      fontSize: "11px",
      fontWeight: "700",
      color: "#ffffff",
      backgroundColor: "#8b5cf6",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      fontFamily: "'Inter', -apple-system, sans-serif",
      transition: "background-color 0.2s, transform 0.1s",
      boxShadow: "0 2px 5px rgba(139, 92, 246, 0.2)",
      lineHeight: "1.2",
      verticalAlign: "middle"
    });

    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Extract Lead</span>
    `;

    chrome.storage.local.get({ extractedLeads: [] }, (result) => {
      const list = result.extractedLeads || [];
      const exists = list.some(item => item.email.toLowerCase() === lead.email.toLowerCase());
      if (exists) {
        setSavedState(btn);
      }
    });

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      btn.style.transform = "scale(0.95)";
      setTimeout(() => btn.style.transform = "none", 100);
      saveLeadToStorage(lead, false, btn);
    });

    btn.addEventListener("mouseenter", () => {
      if (!btn.disabled) btn.style.backgroundColor = "#7c3aed";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.disabled) btn.style.backgroundColor = "#8b5cf6";
    });

    container.appendChild(btn);
  }

  function setSavedState(btn) {
    btn.disabled = true;
    Object.assign(btn.style, {
      backgroundColor: "#10b981",
      boxShadow: "none",
      cursor: "default",
      opacity: "0.9"
    });
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Saved</span>
    `;
  }

  // Save lead details to local storage
  function saveLeadToStorage(lead, isAutomatedRun = false, btnToUpdate = null) {
    chrome.storage.local.get({ extractedLeads: [] }, (result) => {
      const list = result.extractedLeads || [];
      const exists = list.some(item => item.email.toLowerCase() === lead.email.toLowerCase());

      if (!exists) {
        const updatedList = [lead, ...list];
        if (updatedList.length > 200) updatedList.pop();

        chrome.storage.local.set({ extractedLeads: updatedList }, () => {
          if (btnToUpdate) setSavedState(btnToUpdate);
          showToast(lead);

          if (isAutomatedRun) {
            // Signal background automation of success
            chrome.runtime.sendMessage({
              type: "AUTOMATION_COMPLETE",
              profileUrl: pendingUrl,
              lead: lead,
              success: true
            }).catch(() => {});
            stopAutomation();
          } else {
            logAutomation(`Manually extracted lead: ${lead.fullName} (${lead.email})`);
          }

          // Send message to update popup UI
          chrome.runtime.sendMessage({ type: "NEW_LEAD_EXTRACTED", data: lead }).catch(() => {});
        });
      } else {
        if (btnToUpdate) setSavedState(btnToUpdate);
        showToast(lead);
        if (isAutomatedRun) {
          // Already exists, still mark as completed
          chrome.runtime.sendMessage({
            type: "AUTOMATION_COMPLETE",
            profileUrl: pendingUrl,
            lead: lead,
            success: true
          }).catch(() => {});
          stopAutomation();
        }
      }
    });
  }

  // Glassmorphic success Toast
  function showToast(lead) {
    const existingToast = document.getElementById("mailmeteor-extractor-toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.id = "mailmeteor-extractor-toast";
    
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "14px",
      minWidth: "300px",
      maxWidth: "420px",
      padding: "16px",
      background: "rgba(18, 18, 24, 0.95)",
      backdropFilter: "blur(12px)",
      webkitBackdropFilter: "blur(12px)",
      border: "1px solid rgba(139, 92, 246, 0.3)",
      borderRadius: "12px",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
      color: "#ffffff",
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontSize: "14px",
      transition: "opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      transform: "translateY(40px) scale(0.95)",
      opacity: "0",
      pointerEvents: "auto",
      cursor: "pointer"
    });

    const iconContainer = document.createElement("div");
    Object.assign(iconContainer.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "36px",
      height: "36px",
      borderRadius: "50%",
      backgroundColor: "rgba(139, 92, 246, 0.15)",
      border: "1px solid rgba(139, 92, 246, 0.3)",
      flexShrink: "0"
    });
    iconContainer.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 6L9 17L4 12" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    const textContainer = document.createElement("div");
    Object.assign(textContainer.style, {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      flexGrow: "1",
      minWidth: "0"
    });

    const title = document.createElement("div");
    title.textContent = "Lead Saved!";
    Object.assign(title.style, {
      fontWeight: "700",
      fontSize: "12px",
      color: "#a78bfa",
      textTransform: "uppercase",
      letterSpacing: "0.8px"
    });

    const nameText = document.createElement("div");
    nameText.textContent = lead.fullName;
    Object.assign(nameText.style, {
      fontWeight: "600",
      color: "#ffffff",
      fontSize: "14px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    });

    const detailsText = document.createElement("div");
    detailsText.textContent = `${lead.companyName} • ${lead.email}`;
    Object.assign(detailsText.style, {
      color: "#9ca3af",
      fontSize: "12px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    });

    textContainer.appendChild(title);
    textContainer.appendChild(nameText);
    textContainer.appendChild(detailsText);

    const closeBtn = document.createElement("button");
    Object.assign(closeBtn.style, {
      background: "none",
      border: "none",
      color: "#6b7280",
      cursor: "pointer",
      padding: "4px",
      marginLeft: "4px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "color 0.2s"
    });
    closeBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    closeBtn.addEventListener("mouseenter", () => closeBtn.style.color = "#ffffff");
    closeBtn.addEventListener("mouseleave", () => closeBtn.style.color = "#6b7280");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissToast(toast);
    });

    toast.appendChild(iconContainer);
    toast.appendChild(textContainer);
    toast.appendChild(closeBtn);
    toast.addEventListener("click", () => dismissToast(toast));

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transform = "translateY(0) scale(1)";
      toast.style.opacity = "1";
    }, 50);

    const dismissTimeout = setTimeout(() => dismissToast(toast), 4500);

    function dismissToast(element) {
      clearTimeout(dismissTimeout);
      element.style.transform = "translateY(20px) scale(0.95)";
      element.style.opacity = "0";
      setTimeout(() => {
        if (element.parentNode) element.remove();
      }, 400);
    }
  }

  // Startup verification for pending automation
  function checkPendingSearch() {
    chrome.storage.local.get("pendingAutomationSearch", (result) => {
      const pending = result.pendingAutomationSearch;
      if (!pending) return;

      pendingUrl = pending;
      const urlParams = new URLSearchParams(window.location.search);
      const queryUrl = urlParams.get("linkedin-url");

      if (queryUrl && cleanUrl(queryUrl) === cleanUrl(pending)) {
        isAutomatedSearch = true;
        searchStartTime = Date.now();
        logAutomation(`Mailmeteor tab loaded query. Scraper observer active for profile URL.`);
        
        // Start watchdog timer
        startWatchdog();
        
        // Start 500ms polling loop fallback
        pollInterval = setInterval(checkResults, 500);
        
        // Run checkResults immediately to avoid observer race conditions
        checkResults();
      }
    });
  }

  // Manual trigger via popup message
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TRIGGER_EXTRACTION") {
      checkResults();
      chrome.storage.local.get({ extractedLeads: [] }, (result) => {
        sendResponse({ ok: true, data: result.extractedLeads });
      });
      return true;
    }
  });

  // Start execution
  checkPendingSearch();
  initObserver();
})();
