// linkedinJobScraper.js

function deduplicateText(str) {
  if (!str) return "";
  str = str.replace(/\s+/g, " ").trim();
  
  // Remove "with verification" suffix
  str = str.replace(/\s+with verification/gi, "").trim();
  
  // Try splitting by words and checking if it's repeated
  const words = str.split(" ");
  if (words.length > 1 && words.length % 2 === 0) {
    const halfLen = words.length / 2;
    const part1 = words.slice(0, halfLen).join(" ");
    const part2 = words.slice(halfLen).join(" ");
    if (part1.toLowerCase() === part2.toLowerCase()) {
      return part1;
    }
  }
  
  // Try string length bisection
  const mid = Math.floor(str.length / 2);
  const firstHalf = str.substring(0, mid).trim();
  const secondHalf = str.substring(str.length - mid).trim();
  if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
    return firstHalf;
  }
  
  return str;
}

console.log("[JobScraper] Content script loaded.");

if (window.location.href.includes("linkedin.com/jobs/search")) {
  // Wait for initial elements to render
  setTimeout(async () => {
    console.log("[JobScraper] Requesting settings from background...");
    chrome.runtime.sendMessage({ type: "GET_JOB_SEARCH_SETTINGS" }, (response) => {
      if (response && response.settings) {
        scrapeJobs(response.settings);
      } else {
        console.error("[JobScraper] Failed to retrieve settings from background.");
      }
    });
  }, 4000);
}

async function scrapeJobs(settings) {
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Scraper] Starting job harvest. Filters -> Query: "${settings.jobSearchQuery}", Locations: "${settings.jobSearchLocations}", Keywords: "${settings.jobSearchKeywords}"`
  });
  
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Scraper] Waiting for job cards to render on page...`
  });
  
  // Wait for up to 15 seconds for job cards to render
  let cards = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    cards = Array.from(document.querySelectorAll('li[data-occludable-job-id], [data-job-id], .job-card-container, .job-card-list'));
    if (cards.length > 0) {
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  if (cards.length === 0) {
    chrome.runtime.sendMessage({
      type: "LOG",
      message: `[Scraper] Halted: No job cards rendered on LinkedIn after 15s. Page might still be loading, blank, or not logged in.`
    });
    // Send empty result to close tab
    chrome.runtime.sendMessage({
      type: "HARVESTED_JOBS_RESULT",
      jobs: []
    });
    return;
  }
  
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Scraper] Found ${cards.length} potential job cards on page. Scrolling to load more...`
  });
  
  // 1. Scroll the job list pane to load cards (incremental scrolling to trigger lazy loading)
  const scrollContainer = document.querySelector(
    '.jobs-search-results-list, ' +
    '.jobs-search-results-list__list, ' +
    '.scaffold-layout__list-container, ' +
    'div[class*="jobs-search-results-list"], ' +
    'div[class*="scaffold-layout__list"]'
  ) || window;
  
  if (scrollContainer !== window) {
    for (let i = 1; i <= 6; i++) {
      scrollContainer.scrollTop = (scrollContainer.scrollHeight / 6) * i;
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    for (let i = 0; i < 4; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Re-evaluate cards list after scroll
  cards = Array.from(document.querySelectorAll('li[data-occludable-job-id], [data-job-id], .job-card-container, .job-card-list'));
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Scraper] Scraped ${cards.length} cards after scrolling. Applying filters...`
  });
  
  const harvestedJobs = [];
  
  // Parse locations setting
  const allowedLocations = (settings.jobSearchLocations || "")
    .split(',')
    .map(l => l.trim().toLowerCase())
    .filter(Boolean);
      
  // Parse workplace types
  const allowedWorkplaces = (settings.jobSearchWorkplaceTypes || "")
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);
      
  // Parse keywords
  const requiredKeywords = (settings.jobSearchKeywords || "")
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);
  
  for (const card of cards) {
    try {
      const jobId = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
      if (!jobId) continue;
      
      // Fallback selectors for Title
      const titleEl = card.querySelector(
        '.job-card-list__title, ' +
        '.job-card-container__link, ' +
        '.artdeco-entity-lockup__title a, ' +
        'a[class*="job-title"], ' +
        'a[href*="/jobs/view/"], ' +
        'a[href*="currentJobId="]'
      );
      
      let jobLink = `https://www.linkedin.com/jobs/view/${jobId}`;
      if (titleEl && titleEl.getAttribute('href')) {
        const href = titleEl.getAttribute('href');
        if (href.startsWith('http')) {
          jobLink = href;
        } else if (href.startsWith('/')) {
          jobLink = `https://www.linkedin.com${href}`;
        }
      }
      
      // Fallback selectors for Company
      const companyEl = card.querySelector(
        '.job-card-container__company-name, ' +
        '.job-card-list__company-name, ' +
        '.job-card-container__primary-description, ' +
        '.artdeco-entity-lockup__subtitle, ' +
        '[class*="company-name"], ' +
        '[class*="subtitle"]'
      );
      
      // Select all metadata elements inside the card to get location and workplace type robustly
      const metadataEls = card.querySelectorAll(
        '.job-card-container__metadata-item, ' +
        '.job-card-container__metadata-item--list, ' +
        '.job-card-container__secondary-description, ' +
        '.artdeco-entity-lockup__caption, ' +
        '[class*="metadata-item"], ' +
        '[class*="caption"]'
      );
      const locationText = Array.from(metadataEls)
        .map(el => el.innerText.replace(/[\r\n]+/g, " ").trim())
        .join(" ");
      
      const rawTitle = titleEl ? titleEl.innerText.replace(/[\r\n]+/g, " ").trim() : "";
      const rawCompany = companyEl ? companyEl.innerText.replace(/[\r\n]+/g, " ").trim() : "";
      
      const title = deduplicateText(rawTitle);
      const companyName = deduplicateText(rawCompany);
      
      if (!title || !companyName) {
        continue;
      }
      
      let screenOutReasons = [];
      
      // Filter by location
      const matchesLocation = allowedLocations.length === 0 || allowedLocations.some(loc => {
        if (loc === "bangalore" || loc === "bengluru" || loc === "bengaluru") {
          return locationText.toLowerCase().includes("bangalore") || locationText.toLowerCase().includes("bengaluru");
        }
        if (loc === "gurugram" || loc === "gurgaon") {
          return locationText.toLowerCase().includes("gurugram") || locationText.toLowerCase().includes("gurgaon");
        }
        return locationText.toLowerCase().includes(loc);
      });
      if (!matchesLocation) {
        screenOutReasons.push(`Location: "${locationText}"`);
      }
      
      // Filter by Workplace Type (Hybrid / Remote / On-site)
      let workplaceType = "Unspecified";
      if (locationText.toLowerCase().includes("remote")) {
        workplaceType = "Remote";
      } else if (locationText.toLowerCase().includes("hybrid")) {
        workplaceType = "Hybrid";
      } else if (locationText.toLowerCase().includes("on-site") || locationText.toLowerCase().includes("onsite")) {
        workplaceType = "On-site";
      }
      
      const matchesWorkplace = allowedWorkplaces.length === 0 || 
                               workplaceType === "Unspecified" || 
                               allowedWorkplaces.some(w => workplaceType.toLowerCase().includes(w));
      if (!matchesWorkplace) {
        screenOutReasons.push(`Workplace: "${workplaceType}"`);
      }
      
      // Filter by query (relaxed to avoid false negatives on LinkedIn's search results)
      const queryTerms = (settings.jobSearchQuery || "DevOps").toLowerCase().split(/\s+/).filter(t => t.length > 2);
      const matchesQuery = queryTerms.length === 0 || 
                           queryTerms.some(term => title.toLowerCase().includes(term)) ||
                           title.toLowerCase().includes("devops") ||
                           title.toLowerCase().includes("sre") ||
                           title.toLowerCase().includes("reliability") ||
                           title.toLowerCase().includes("platform") ||
                           title.toLowerCase().includes("infrastructure");
      if (!matchesQuery) {
        screenOutReasons.push(`Role mismatch: "${title}"`);
      }
      
      let screenedOut = screenOutReasons.length > 0;
      
      if (!screenedOut) {
        // Upfront checks passed, click card to extract description for detailed checks
        const clickable = card.querySelector('a, .job-card-list__title') || card;
        const descElBefore = document.querySelector('.jobs-description__content, .jobs-description, [class*="job-description"]');
        const oldDescText = descElBefore ? descElBefore.innerText.trim() : "";
        
        clickable.click();
        
        // Wait for description content to load/update dynamically
        let updatedDescText = "";
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(r => setTimeout(r, 500));
          const currentDescEl = document.querySelector('.jobs-description__content, .jobs-description, [class*="job-description"]');
          updatedDescText = currentDescEl ? currentDescEl.innerText.trim() : "";
          if (updatedDescText && updatedDescText !== oldDescText) {
            break;
          }
        }
        
        const descText = updatedDescText.toLowerCase();
        
        // 1. Smart experience year limit filter (suitable for a 1.5 year experience candidate)
        let matchesExperienceYears = true;
        let expRejectReason = "";
        const expRangeRegex = /(\d+)\s*(?:-|to)\s*(\d+)\s*(?:yrs?|years?)\s*(?:of\s*)?(?:exp|experience)\b/gi;
        const expSingleRegex = /(\d+)\+?\s*(?:yrs?|years?)\s*(?:of\s*)?(?:exp|experience)\b/gi;
        
        let rangeMatch;
        let hasRange = false;
        while ((rangeMatch = expRangeRegex.exec(descText)) !== null) {
          hasRange = true;
          const minYears = parseFloat(rangeMatch[1]);
          if (!isNaN(minYears) && minYears > 2) {
            matchesExperienceYears = false;
            expRejectReason = `Requires min ${minYears} years`;
            break;
          }
        }
        
        if (matchesExperienceYears && !hasRange) {
          let singleMatch;
          while ((singleMatch = expSingleRegex.exec(descText)) !== null) {
            const years = parseFloat(singleMatch[1]);
            if (!isNaN(years) && years > 2) {
              matchesExperienceYears = false;
              expRejectReason = `Requires ${years}+ years`;
              break;
            }
          }
        }
        
        if (!matchesExperienceYears) {
          screenOutReasons.push(expRejectReason);
        }
        
        // 2. Custom description keywords check (e.g. 5 days)
        let matchesKeywords = true;
        let keywordRejectReason = "";
        if (requiredKeywords.length > 0) {
          matchesKeywords = requiredKeywords.every(keyword => {
            if (keyword === "5 days") {
              return descText.includes("5 days") || 
                     descText.includes("5-days") || 
                     descText.includes("five days") || 
                     descText.includes("5day") || 
                     descText.includes("5-day") ||
                     descText.includes("5days") ||
                     descText.includes("five-day") ||
                     descText.includes("5 working days") ||
                     descText.includes("5-working days") ||
                     descText.includes("five working days") ||
                     descText.includes("5 days/week") ||
                     descText.includes("5 days a week");
            }
            return descText.includes(keyword);
          });
          
          if (!matchesKeywords) {
            keywordRejectReason = `Missing keyword: "${settings.jobSearchKeywords}"`;
            screenOutReasons.push(keywordRejectReason);
          }
        }
        
        screenedOut = screenOutReasons.length > 0;
      }
      
      const screenOutReason = screenedOut 
        ? screenOutReasons.join(", ")
        : "";
      
      chrome.runtime.sendMessage({
        type: "LOG",
        message: `[Scraper] MATCHED card: "${title}" at "${companyName}" (${locationText}, ${workplaceType}) -> Screened Out: ${screenedOut}${screenedOut ? ` (${screenOutReason})` : ""}`
      });
      
      harvestedJobs.push({
        jobId,
        title,
        companyName,
        location: locationText,
        workplaceType,
        jobLink,
        screenedOut,
        screenOutReason
      });
      
    } catch (cardErr) {
      console.error("[JobScraper] Error parsing card:", cardErr);
      chrome.runtime.sendMessage({
        type: "LOG",
        message: `[Scraper] Error parsing card: ${cardErr.message || cardErr}`
      });
    }
  }
  
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Scraper] Harvesting complete. Found ${harvestedJobs.length} matched jobs.`
  });
  
  // Send results back to background
  chrome.runtime.sendMessage({
    type: "HARVESTED_JOBS_RESULT",
    jobs: harvestedJobs
  });
}
