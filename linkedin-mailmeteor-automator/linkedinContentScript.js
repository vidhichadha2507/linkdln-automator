(() => {
  if (window.__linkedinPeopleExtractorLoaded) {
    return;
  }
  window.__linkedinPeopleExtractorLoaded = true;

  let savedProfileUrls = new Set();
  let processingUrls = new Set();

  // Inject CSS spinner animation keyframe into page header
  function injectSpinnerStyle() {
    if (document.getElementById('automator-spinner-style')) return;
    const style = document.createElement('style');
    style.id = 'automator-spinner-style';
    style.textContent = `
      @keyframes automatorSpin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  // Helper to check if extension context is still valid (survives extension reloads/updates)
  function isContextValid() {
    return !!(chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local);
  }

  // Load saved profile URLs and active processing queues from storage
  function loadSavedProfiles() {
    if (!isContextValid()) return;
    chrome.storage.local.get({ savedProfiles: [], processingUrls: [] }, (result) => {
      if (!isContextValid()) return;
      savedProfileUrls = new Set((result.savedProfiles || []).map(p => p.profileUrl));
      processingUrls = new Set(result.processingUrls || []);
      injectSpinnerStyle();
      injectButtons();
    });
  }

  // Helper to clean URL of tracking params
  function cleanUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch (e) {
      return url;
    }
  }

  // Helper to clean text
  function cleanText(text) {
    return (text ?? "").replace(/\s+/g, " ").trim();
  }

  // Extract company name from the page context
  function extractCompanyName() {
    const headerEl = document.querySelector('.org-top-card-summary__title, .org-top-card-summary-info-list__info-item, main h1');
    if (headerEl && headerEl.textContent.trim()) {
      return cleanText(headerEl.textContent);
    }
    const title = document.title;
    if (title) {
      const cleanTitle = title.split(':')[0].split('|')[0].trim();
      return cleanTitle;
    }
    return '';
  }

  // Extract all details from a single card
  function extractProfileFromCard(card) {
    const linkEl = card.querySelector('a[href*="/in/"]');
    if (!linkEl) return null;

    const profileUrl = cleanUrl(linkEl.href);

    // Extract name
    const titleEl = card.querySelector('.artdeco-entity-lockup__title');
    let fullName = titleEl ? titleEl.textContent.trim() : '';
    // Strip pronouns
    fullName = fullName.replace(/\s*\([^)]*\)/g, "").trim();

    // Extract job title/headline
    const subtitleEl = card.querySelector('.artdeco-entity-lockup__subtitle');
    const headline = subtitleEl ? cleanText(subtitleEl.textContent) : '';

    // Extract connection degree
    const degreeEl = card.querySelector('.artdeco-entity-lockup__degree') || card.querySelector('.artdeco-entity-lockup__badge');
    let degree = degreeEl ? cleanText(degreeEl.textContent).replace(/[·•]/g, '').trim() : '';
    if (degree && degree.toLowerCase().includes('degree connection')) {
      degree = degree.toLowerCase().replace('degree connection', '').trim();
    }
    if (!degree) degree = '2nd'; // Fallback

    // Extract avatar image
    const imgEl = card.querySelector('.artdeco-entity-lockup__image img, img');
    let avatarUrl = '';
    if (imgEl && imgEl.src && !imgEl.src.startsWith('data:')) {
      avatarUrl = imgEl.src;
    }

    // Extract mutual connections info
    const mutualEl = card.querySelector('.org-people-profile-card__profile-info > span.text-align-center span') || card.querySelector('span.t-12.t-black--light');
    const mutualInfo = mutualEl ? cleanText(mutualEl.textContent) : '';

    const companyName = extractCompanyName();

    return {
      id: profileUrl,
      fullName,
      profileUrl,
      headline,
      avatarUrl,
      degree,
      mutualInfo,
      companyName,
      savedAt: new Date().toISOString()
    };
  }

  // Save profile to storage and trigger automation queue
  function saveProfile(profileData, button) {
    if (!isContextValid()) {
      showToast("Extension updated. Please refresh the page to save.");
      return;
    }
    chrome.storage.local.get({ savedProfiles: [] }, (result) => {
      if (!isContextValid()) return;
      const savedProfiles = result.savedProfiles || [];

      // Save local profile immediately
      if (!savedProfiles.some(p => p.profileUrl === profileData.profileUrl)) {
        savedProfiles.push(profileData);
        chrome.storage.local.set({ savedProfiles }, () => {
          if (!isContextValid()) return;
          savedProfileUrls.add(profileData.profileUrl);
          if (isProfilePage()) {
            updateProfileButtonToProcessing(button);
          } else {
            updateButtonToProcessing(button);
          }
          showToast(`Saved ${profileData.fullName} and added to automation queue.`);

          // Trigger automation queue on background script
          chrome.runtime.sendMessage({
            type: "START_AUTOMATION",
            profile: profileData
          });
        });
      }
    });
  }

  // UI: Show toast notification on page
  function showToast(message) {
    let container = document.getElementById('custom-extension-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'custom-extension-toast-container';
      container.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      padding: 12px 20px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      gap: 10px;
      transform: translateY(-20px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    `;

    toast.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.2); border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });

    setTimeout(() => {
      toast.style.transform = 'translateY(-20px)';
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }

  // Update button look to "Saved" (completed success state)
  function updateButtonToSaved(button) {
    button.classList.remove('processing');
    button.classList.add('saved');
    button.disabled = true;
    button.style.cssText = `
      background-color: #059669 !important;
      border-color: #059669 !important;
      color: #ffffff !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: not-allowed;
      opacity: 0.9;
      width: 100%;
      height: 32px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-top: 8px;
    `;
    button.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Saved</span>
    `;
  }

  // Update button look to "Processing..." (active loading state)
  function updateButtonToProcessing(button) {
    button.classList.remove('saved');
    button.classList.add('processing');
    button.disabled = true;
    button.style.cssText = `
      background-color: #d97706 !important;
      border-color: #d97706 !important;
      color: #ffffff !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6.5px;
      cursor: not-allowed;
      width: 100%;
      height: 32px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-top: 8px;
    `;
    button.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: automatorSpin 1.1s linear infinite;">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      <span>Processing...</span>
    `;
  }

  // Update button look to "Save & Find Email" (initial state)
  function updateButtonToUnsaved(button) {
    button.classList.remove('saved');
    button.classList.remove('processing');
    button.disabled = false;
    button.style.cssText = `
      background-color: #4f46e5 !important;
      border-color: #4f46e5 !important;
      color: #ffffff !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      width: 100%;
      height: 32px;
      border-radius: 16px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-top: 8px;
    `;
    button.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
      <span>Save & Find Email</span>
    `;
  }

  // Check if current URL is a company/school/showcase people section
  function isPeoplePage() {
    const url = window.location.href;
    const isCompanyOrSchoolOrShowcase = url.includes("/company/") || url.includes("/school/") || url.includes("/showcase/");
    return isCompanyOrSchoolOrShowcase && url.includes("/people");
  }

  // Check if current URL is a person's LinkedIn profile page
  function isProfilePage() {
    const url = window.location.href;
    return url.includes("/in/") && !url.includes("/people") && !url.includes("/overlay/");
  }

  // Profile Page UI: Update button look to "Saved" (completed success state)
  function updateProfileButtonToSaved(button) {
    button.classList.remove('processing');
    button.classList.add('saved');
    button.disabled = true;
    button.style.cssText = `
      background-color: #059669 !important;
      border-color: #059669 !important;
      color: #ffffff !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: not-allowed;
      opacity: 0.9;
      height: 32px;
      padding: 0 16px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-right: 8px;
      margin-top: 4px;
      margin-bottom: 4px;
    `;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Saved</span>
    `;
  }

  // Profile Page UI: Update button look to "Processing..." (active loading state)
  function updateProfileButtonToProcessing(button) {
    button.classList.remove('saved');
    button.classList.add('processing');
    button.disabled = true;
    button.style.cssText = `
      background-color: #d97706 !important;
      border-color: #d97706 !important;
      color: #ffffff !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6.5px;
      cursor: not-allowed;
      height: 32px;
      padding: 0 16px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-right: 8px;
      margin-top: 4px;
      margin-bottom: 4px;
    `;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: automatorSpin 1.1s linear infinite;">
        <line x1="12" y1="2" x2="12" y2="6"></line>
        <line x1="12" y1="18" x2="12" y2="22"></line>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
        <line x1="2" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="22" y2="12"></line>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
      </svg>
      <span>Processing...</span>
    `;
  }

  // Profile Page UI: Update button look to "Save & Find Email" (initial state)
  function updateProfileButtonToUnsaved(button) {
    button.classList.remove('saved');
    button.classList.remove('processing');
    button.disabled = false;
    button.style.cssText = `
      background-color: #4f46e5 !important;
      border-color: #4f46e5 !important;
      color: #ffffff !important;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      height: 32px;
      padding: 0 16px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid transparent;
      transition: all 0.2s ease;
      margin-right: 8px;
      margin-top: 4px;
      margin-bottom: 4px;
    `;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
      <span>Save & Find Email</span>
    `;
  }

  // Extract all details from the profile page
  function extractProfileFromPage() {
    const profileUrl = cleanUrl(window.location.href);

    // Extract name
    const nameEl = document.querySelector('h1.t-24, h1.text-heading-xlarge, main h1');
    let fullName = nameEl ? nameEl.textContent.trim() : '';
    fullName = fullName.replace(/\s*\([^)]*\)/g, "").trim();

    // Extract job title/headline
    const headlineEl = document.querySelector('.text-body-medium');
    const headline = headlineEl ? cleanText(headlineEl.textContent) : '';

    // Extract connection degree
    const degreeEl = document.querySelector('.distance-badge, .dist-value');
    let degree = degreeEl ? cleanText(degreeEl.textContent).replace(/[·•]/g, '').trim() : '';
    if (degree && degree.toLowerCase().includes('degree connection')) {
      degree = degree.toLowerCase().replace('degree connection', '').trim();
    }
    if (!degree) degree = '2nd';

    // Extract avatar image
    const avatarEl = document.querySelector('.pv-top-card-profile-picture__image--show, .pv-top-card__photo img, .pv-top-card-profile-picture__container img');
    let avatarUrl = '';
    if (avatarEl && avatarEl.src && !avatarEl.src.startsWith('data:')) {
      avatarUrl = avatarEl.src;
    }

    // Extract company name
    let companyName = '';
    const companyBtn = document.querySelector('button[aria-label^="Current company:"]');
    if (companyBtn) {
      const ariaLabel = companyBtn.getAttribute('aria-label');
      const match = ariaLabel ? ariaLabel.match(/Current company:\s*([^.]+)/) : null;
      if (match) {
        companyName = cleanText(match[1]);
      } else {
        companyName = cleanText(companyBtn.textContent);
      }
    }
    if (!companyName) {
      const companyEl = document.querySelector('.pv-text-details__right-panel .inline-show-more-text');
      if (companyEl) {
        companyName = cleanText(companyEl.textContent);
      }
    }

    // Extract mutual connections info
    const mutualEl = document.querySelector('a[href*="facetConnectionOf"] span, a[href*="mutual"] span, .pv-text-details__separator + span');
    const mutualInfo = mutualEl ? cleanText(mutualEl.textContent) : '';

    return {
      id: profileUrl,
      fullName,
      profileUrl,
      headline,
      avatarUrl,
      degree,
      mutualInfo,
      companyName,
      savedAt: new Date().toISOString()
    };
  }

  // Find all action button containers on the profile page
  function findProfileActionsContainers() {
    const containers = new Set();

    // Find via the "More actions" button
    const moreBtns = document.querySelectorAll('button[aria-label="More actions"], button[id*="-profile-overflow-action"], [data-entry-point="profile-actions"] button');
    moreBtns.forEach(btn => {
      const dropdown = btn.closest('.artdeco-dropdown');
      if (dropdown && dropdown.parentElement) {
        containers.add(dropdown.parentElement);
      } else if (btn.parentElement) {
        containers.add(btn.parentElement);
      }
    });

    const selectors = [
      '.pv-top-card-v2-ctas',
      '.pvs-profile-actions',
      '.pv-top-card-section__actions',
      '.pv-top-card__actions'
    ];
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      elements.forEach(el => containers.add(el));
    }

    return Array.from(containers);
  }

  // Inject button specifically for a profile page
  function injectProfileButton() {
    if (!isProfilePage()) return;

    const url = cleanUrl(window.location.href);
    const isSaved = savedProfileUrls.has(url);
    const isProcessing = processingUrls.has(url);

    const targetContainers = findProfileActionsContainers();
    if (targetContainers.length === 0) return;

    targetContainers.forEach(targetContainer => {
      const existingBtn = targetContainer.querySelector('.custom-save-profile-btn');

      if (existingBtn) {
        if (isSaved) {
          if (!existingBtn.classList.contains('saved')) updateProfileButtonToSaved(existingBtn);
        } else if (isProcessing) {
          if (!existingBtn.classList.contains('processing')) updateProfileButtonToProcessing(existingBtn);
        } else {
          if (existingBtn.classList.contains('saved') || existingBtn.classList.contains('processing')) {
            updateProfileButtonToUnsaved(existingBtn);
          }
        }
        return;
      }

      const button = document.createElement('button');
      button.className = 'custom-save-profile-btn';

      if (isSaved) {
        updateProfileButtonToSaved(button);
      } else if (isProcessing) {
        updateProfileButtonToProcessing(button);
      } else {
        updateProfileButtonToUnsaved(button);
      }

      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const profileData = extractProfileFromPage();
        if (profileData && profileData.fullName) {
          saveProfile(profileData, button);
        } else {
          showToast("Error extracting profile details. Try again.");
        }
      });

      const dropdown = targetContainer.querySelector('.artdeco-dropdown');
      if (dropdown) {
        targetContainer.insertBefore(button, dropdown);
      } else {
        targetContainer.appendChild(button);
      }
    });
  }

  // Scan and inject button for company/school/showcase people section
  function injectPeopleSectionButtons() {
    // Use broader selectors for card elements to prevent layout brittleness
    const cards = document.querySelectorAll(
      'li.org-people-profile-card__profile-card-spacing, ' +
      'li[class*="org-people-profile-card"], ' +
      '.org-people-profile-card, ' +
      'li.org-people-profile-card'
    );

    cards.forEach(card => {
      const profileLinkEl = card.querySelector('a[href*="/in/"]');
      if (!profileLinkEl) return;

      const url = cleanUrl(profileLinkEl.href);
      const isSaved = savedProfileUrls.has(url);
      const isProcessing = processingUrls.has(url);

      const existingBtn = card.querySelector('.custom-save-profile-btn');

      if (existingBtn) {
        if (isSaved) {
          if (!existingBtn.classList.contains('saved')) updateButtonToSaved(existingBtn);
        } else if (isProcessing) {
          if (!existingBtn.classList.contains('processing')) updateButtonToProcessing(existingBtn);
        } else {
          if (existingBtn.classList.contains('saved') || existingBtn.classList.contains('processing')) {
            updateButtonToUnsaved(existingBtn);
          }
        }
        return;
      }

      // Inject to footer, profile-info, artdeco lockup content, or card itself
      const targetContainer = card.querySelector('footer') ||
        card.querySelector('.org-people-profile-card__profile-info') ||
        card.querySelector('.artdeco-entity-lockup__content') ||
        card.querySelector('.artdeco-entity-lockup') ||
        card;
      if (!targetContainer) return;

      const button = document.createElement('button');
      button.className = 'custom-save-profile-btn';

      if (isSaved) {
        updateButtonToSaved(button);
      } else if (isProcessing) {
        updateButtonToProcessing(button);
      } else {
        updateButtonToUnsaved(button);
      }

      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const profileData = extractProfileFromCard(card);
        if (profileData) {
          saveProfile(profileData, button);
        }
      });

      targetContainer.appendChild(button);
    });
  }

  // Scan and inject buttons based on current page type
  function injectButtons() {
    if (isPeoplePage()) {
      injectPeopleSectionButtons();
    }
    if (isProfilePage()) {
      injectProfileButton();
    }
  }

  // Setup mutation observer to scan as user scrolls
  let observer = new MutationObserver(() => {
    if (!isContextValid()) {
      try { observer.disconnect(); } catch (e) { }
      return;
    }
    injectButtons();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message) => {
    if (!isContextValid()) return;
    if (message.type === "REFRESH_SAVED_PROFILES") {
      loadSavedProfiles();
    } else if (message.type === "URL_CHANGED") {
      // Re-initialize saved profiles and inject buttons immediately and with safe delays for lazy rendering
      loadSavedProfiles();
      setTimeout(() => { if (isContextValid()) loadSavedProfiles(); }, 500);
      setTimeout(() => { if (isContextValid()) loadSavedProfiles(); }, 1500);
      setTimeout(() => { if (isContextValid()) loadSavedProfiles(); }, 3000);
    }
  });

  // Initial load
  loadSavedProfiles();

  // Polling fallback to ensure SPA navigation is captured
  const pollInterval = setInterval(() => {
    if (!isContextValid()) {
      clearInterval(pollInterval);
      return;
    }
    if (isPeoplePage() || isProfilePage()) {
      injectButtons();
    }
  }, 1500);
})();
