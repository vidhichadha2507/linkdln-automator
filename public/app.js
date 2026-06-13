// Job Outreach Automator Client Application Logic

document.addEventListener("DOMContentLoaded", () => {
  // Application State
  const state = {
    summary: {},
    leads: [],
    companies: [],
    applications: [],
    events: [],
    queue: [],
    templates: [],
    editingTemplateId: null,
    editingApplicationId: null,
    lastFocusedTemplateField: null,
    selectedLeadId: null,
    bulkCompanyId: null,
    bulkTag: null,
    resumeName: null,
    resumeBase64: null,
    leadsCompanyFilter: "all",
    leadsStatusFilter: "all",
    queueSearchQuery: "",
    queueStatusFilter: "all",
    companyQueueSearchQuery: "",
    companyQueueStatusFilter: "all"
  };

  // DOM Elements
  const tabs = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");
  const metricsSection = document.getElementById("metrics");
  const leadsTableContainer = document.getElementById("leadsTableContainer");
  const queueTableContainer = document.getElementById("queueTableContainer");
  const queueSearchInput = document.getElementById("queueSearchInput");
  const queueStatusFilter = document.getElementById("queueStatusFilter");
  const queueCountBadge = document.getElementById("queueCountBadge");

  const companyQueueTableContainer = document.getElementById("companyQueueTableContainer");
  const companyQueueSearchInput = document.getElementById("companyQueueSearchInput");
  const companyQueueStatusFilter = document.getElementById("companyQueueStatusFilter");
  const companyQueueCountBadge = document.getElementById("companyQueueCountBadge");

  const editLeadModal = document.getElementById("editLeadModal");
  const editLeadForm = document.getElementById("editLeadForm");
  const editLeadId = document.getElementById("editLeadId");
  const editLeadFullName = document.getElementById("editLeadFullName");
  const editLeadCompany = document.getElementById("editLeadCompany");
  const editLeadEmail = document.getElementById("editLeadEmail");
  const editLeadTags = document.getElementById("editLeadTags");
  const closeEditLeadModalBtn = document.getElementById("closeEditLeadModalBtn");
  const cancelEditLeadBtn = document.getElementById("cancelEditLeadBtn");

  const eventsLogTimeline = document.getElementById("eventsLogTimeline");
  const companiesList = document.getElementById("companiesList");
  const applicationsTableContainer = document.getElementById("applicationsTableContainer");
  const addApplicationForm = document.getElementById("addApplicationForm");
  const appCompanyName = document.getElementById("appCompanyName");
  const appRole = document.getElementById("appRole");
  const appJobId = document.getElementById("appJobId");
  const appJobLink = document.getElementById("appJobLink");
  const appFormSubmitBtn = document.getElementById("appFormSubmitBtn");
  const cancelAppEditBtn = document.getElementById("cancelAppEditBtn");

  // Active Outreach Profiles pagination/search/filter elements
  const leadsSearchInput = document.getElementById("leadsSearchInput");
  const leadsPageInfo = document.getElementById("leadsPageInfo");
  const leadsPrevPageBtn = document.getElementById("leadsPrevPageBtn");
  const leadsNextPageBtn = document.getElementById("leadsNextPageBtn");

  // Pagination & Filtering state
  let leadsCurrentPage = 1;
  const leadsPageSize = 10;

  // Google Sign-In elements
  const googleStatusIndicator = document.getElementById("googleStatusIndicator");
  const googleStatusText = document.getElementById("googleStatusText");
  const connectGoogleButton = document.getElementById("connectGoogleButton");
  const disconnectGoogleButton = document.getElementById("disconnectGoogleButton");
  
  // Controls
  const refreshButton = document.getElementById("refreshButton");
  const runQueueButton = document.getElementById("runQueueButton");
  const pollGmailButton = document.getElementById("pollGmailButton");
  const simulateBounceButton = document.getElementById("simulateBounceButton");
  const simulateEmailInput = document.getElementById("simulateEmailInput");

  // Modal
  const campaignModal = document.getElementById("campaignModal");
  const campaignForm = document.getElementById("campaignForm");
  const formLeadId = document.getElementById("formLeadId");
  const formRecipientEmail = document.getElementById("formRecipientEmail");
  const formJobId = document.getElementById("formJobId");
  const formJobLink = document.getElementById("formJobLink");
  const formRoleName = document.getElementById("formRoleName");
  const formResume = document.getElementById("formResume");
  const formScheduleDate = document.getElementById("formScheduleDate");
  const formAutoFollowup = document.getElementById("formAutoFollowup");
  const formRespectTiming = document.getElementById("formRespectTiming");
  const resumeUploadStatus = document.getElementById("resumeUploadStatus");
  
  const closeModalBtn = document.getElementById("closeModalBtn");
  const cancelModalBtn = document.getElementById("cancelModalBtn");

  // Custom Toast Notifications
  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type === "success" ? "toast-success" : "toast-error"}`;
    toast.style.position = "fixed";
    toast.style.bottom = "24px";
    toast.style.right = "24px";
    toast.style.padding = "14px 24px";
    toast.style.borderRadius = "8px";
    toast.style.zIndex = "9999";
    toast.style.color = "#ffffff";
    toast.style.fontFamily = "'Outfit', sans-serif";
    toast.style.fontWeight = "600";
    toast.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
    toast.style.border = "1px solid rgba(255,255,255,0.08)";
    toast.style.background = type === "success" ? "rgba(16, 185, 129, 0.95)" : "rgba(239, 68, 68, 0.95)";
    toast.style.backdropFilter = "blur(10px)";
    toast.style.transform = "translateY(20px)";
    toast.style.transition = "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease";
    toast.style.opacity = "0";

    toast.innerText = message;
    document.body.appendChild(toast);

    // Trigger animate
    setTimeout(() => {
      toast.style.transform = "translateY(0)";
      toast.style.opacity = "1";
    }, 50);

    // Auto dismiss
    setTimeout(() => {
      toast.style.transform = "translateY(20px)";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Custom Confirmation Dialog using custom modal
  function showConfirm(message) {
    return new Promise((resolve) => {
      const confirmModal = document.getElementById("confirmModal");
      const confirmModalMessage = document.getElementById("confirmModalMessage");
      const submitConfirmModalBtn = document.getElementById("submitConfirmModalBtn");
      const cancelConfirmModalBtn = document.getElementById("cancelConfirmModalBtn");
      const closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn");

      if (!confirmModal || !confirmModalMessage || !submitConfirmModalBtn || !cancelConfirmModalBtn || !closeConfirmModalBtn) {
        resolve(confirm(message));
        return;
      }

      confirmModalMessage.innerText = message;
      confirmModal.classList.add("show");

      const cleanup = (result) => {
        confirmModal.classList.remove("show");
        submitConfirmModalBtn.replaceWith(submitConfirmModalBtn.cloneNode(true));
        cancelConfirmModalBtn.replaceWith(cancelConfirmModalBtn.cloneNode(true));
        closeConfirmModalBtn.replaceWith(closeConfirmModalBtn.cloneNode(true));
        resolve(result);
      };

      document.getElementById("submitConfirmModalBtn").addEventListener("click", () => cleanup(true));
      document.getElementById("cancelConfirmModalBtn").addEventListener("click", () => cleanup(false));
      document.getElementById("closeConfirmModalBtn").addEventListener("click", () => cleanup(false));
    });
  }

  // Tabs Management
  const persistedTabId = localStorage.getItem("activeTabId");
  if (persistedTabId) {
    const targetTab = document.querySelector(`.tab-btn[data-tab="${persistedTabId}"]`);
    if (targetTab) {
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      targetTab.classList.add("active");
      const targetContent = document.getElementById(persistedTabId);
      if (targetContent) {
        targetContent.classList.add("active");
      }
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const contentId = tab.getAttribute("data-tab");
      document.getElementById(contentId).classList.add("active");
      localStorage.setItem("activeTabId", contentId);

      // When switching to Company tab, re-render the list
      if (contentId === "tab-company-insights") {
        renderCompanyInsightsTab();
      }
    });
  });

  // Fetching Data from API with UI Sync Hooks
  async function fetchSummary() {
    try {
      const res = await fetch("/admin/summary");
      state.summary = await res.json();
    } catch (e) {
      console.error("Failed to fetch summary stats:", e);
    }
  }

  async function fetchLeads() {
    try {
      const res = await fetch("/admin/leads");
      state.leads = await res.json();
    } catch (e) {
      console.error("Failed to fetch leads list:", e);
    }
  }

  async function fetchCompanies() {
    try {
      const res = await fetch("/admin/companies");
      state.companies = await res.json();
    } catch (e) {
      console.error("Failed to fetch companies list:", e);
    }
  }

  async function fetchEvents() {
    try {
      const res = await fetch("/admin/events");
      state.events = await res.json();
    } catch (e) {
      console.error("Failed to fetch events logs:", e);
    }
  }

  async function fetchQueue() {
    try {
      const res = await fetch("/admin/queue");
      state.queue = await res.json();
    } catch (e) {
      console.error("Failed to fetch campaign queue:", e);
    }
  }

  async function fetchApplications() {
    try {
      const res = await fetch("/admin/applications");
      state.applications = await res.json();
    } catch (e) {
      console.error("Failed to fetch applications:", e);
    }
  }

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

  async function updateApplicationStatus(appId, newStatus, selectElement) {
    try {
      const res = await fetch(`/admin/applications/${appId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: newStatus })
      });
      const result = await res.json();
      if (result.success) {
        showToast(`Application status updated to "${newStatus}"`);
        
        // Remove old classes and add new class
        selectElement.className = "table-status-select";
        const statusClassMap = {
          "Not Applied": "status-not-applied",
          "Applied": "status-applied",
          "Screen out": "status-screen-out",
          "Reached out": "status-reached-out",
          "Interviewing": "status-interviewing",
          "Selected": "status-selected",
          "Rejected": "status-rejected",
          "Dropped": "status-dropped",
          "Application Closed": "status-closed"
        };
        const currentStatusClass = statusClassMap[newStatus] || "status-not-applied";
        selectElement.classList.add(currentStatusClass);
        
        // Re-fetch to sync updated date and refresh both lists
        await fetchApplications();
        renderApplications();
      } else {
        showToast(result.message || "Failed to update status", "error");
      }
    } catch (err) {
      showToast("Error updating application status.", "error");
    } finally {
      selectElement.disabled = false;
    }
  }

  function attachStatusChangeListeners(containerId) {
    document.querySelectorAll(`#${containerId} .table-status-select`).forEach(select => {
      select.addEventListener("change", (e) => {
        const appId = select.getAttribute("data-app-id");
        const newStatus = select.value;
        select.disabled = true;
        updateApplicationStatus(appId, newStatus, select);
      });
    });
  }

  function renderDiscoveredJobs() {
    const discoveredJobsTableContainer = document.getElementById("discoveredJobsTableContainer");
    if (!discoveredJobsTableContainer) return;

    const filterEl = document.getElementById("discoveredJobsStatusFilter");
    if (filterEl && !filterEl.dataset.listenerAttached) {
      filterEl.addEventListener("change", () => {
        state.discoveredJobsFilter = filterEl.value;
        renderDiscoveredJobs();
      });
      filterEl.dataset.listenerAttached = "true";
    }

    const filterVal = filterEl ? filterEl.value : (state.discoveredJobsFilter || "all");
    state.discoveredJobsFilter = filterVal;

    let apps = (state.applications || []).filter(app => app.jobId);

    if (filterVal === "matched") {
      apps = apps.filter(app => app.status === "Not Applied");
    } else if (filterVal === "screened") {
      apps = apps.filter(app => app.status === "Screen out");
    }

    if (apps.length === 0) {
      discoveredJobsTableContainer.innerHTML = `
        <div class="list-empty" style="padding: 32px 16px; text-align: center; background: rgba(30, 41, 59, 0.3); border-radius: 8px; border: 1px dashed var(--border-color);">
          <p style="font-size: 14.5px; font-weight: 600; color: var(--color-text); margin-bottom: 4px;">No jobs found for the selected status.</p>
          <p class="muted" style="font-size: 13px; color: var(--color-text-muted); margin: 0;">Try changing the status filter dropdown above or trigger a search.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Role</th>
            <th>Job ID</th>
            <th>Job Link</th>
            <th>Discovered Date</th>
            <th>Status</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    apps.forEach(app => {
      const addedDate = new Date(app.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      const jobIdHtml = app.jobId
        ? `<span style="font-family: 'JetBrains Mono', monospace; font-size:12.5px; color:var(--color-text-bright);">${app.jobId}</span>`
        : `<span class="muted" style="font-size:13.5px;">-</span>`;

      const jobLinkHtml = app.jobLink 
        ? `<a href="${app.jobLink}" target="_blank" class="accent-link" style="font-size: 13px;">View Job Link</a>`
        : `<span class="muted" style="font-size: 13px;">-</span>`;

      const statuses = ["Not Applied", "Applied", "Screen out", "Reached out", "Interviewing", "Selected", "Rejected", "Dropped", "Application Closed"];
      const statusClassMap = {
        "Not Applied": "status-not-applied",
        "Applied": "status-applied",
        "Screen out": "status-screen-out",
        "Reached out": "status-reached-out",
        "Interviewing": "status-interviewing",
        "Selected": "status-selected",
        "Rejected": "status-rejected",
        "Dropped": "status-dropped",
        "Application Closed": "status-closed"
      };
      
      const currentStatusClass = statusClassMap[app.status] || "status-not-applied";
      const cleanCompanyName = deduplicateText(app.companyName);
      const cleanRole = deduplicateText(app.role);

      let statusSelectOptions = statuses.map(s => {
        const selected = app.status === s ? "selected" : "";
        return `<option value="${s}" ${selected}>${s}</option>`;
      }).join("");

      const statusSelectHtml = `
        <select class="table-status-select ${currentStatusClass}" data-app-id="${app.id}">
          ${statusSelectOptions}
        </select>
      `;

      const screenOutReasonHtml = (app.screenOutReason && app.status === "Screen out")
        ? `<div style="font-size: 11.5px; color: #ef4444; margin-top: 5px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
             <span style="font-size: 12px; margin-top: -2px;">⚠️</span> ${app.screenOutReason}
           </div>`
        : "";

      html += `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--color-text-bright); font-size:14.5px;">${cleanCompanyName}</div>
          </td>
          <td>
            <div style="font-weight: 500; font-size:13.5px; color:var(--color-text);">${cleanRole}</div>
            ${screenOutReasonHtml}
          </td>
          <td>${jobIdHtml}</td>
          <td>${jobLinkHtml}</td>
          <td>
            <div style="font-size: 13px; color:var(--color-text-muted);">${addedDate}</div>
          </td>
          <td>
            ${statusSelectHtml}
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-outline app-delete-btn" style="border-color: var(--color-danger); color: var(--color-danger); padding: 4px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;" data-app-id="${app.id}" title="Delete Discovered Job" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
    discoveredJobsTableContainer.innerHTML = html;
    attachStatusChangeListeners("discoveredJobsTableContainer");

    // Attach delete listeners
    document.querySelectorAll("#discoveredJobsTableContainer .app-delete-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const appId = button.getAttribute("data-app-id");
        const confirmed = await showConfirm("Are you sure you want to delete this discovered job?");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/applications/${appId}`, {
            method: "DELETE"
          });
          const result = await res.json();
          if (result.success) {
            showToast("Discovered job deleted successfully.");
            await fetchApplications();
            renderApplications();
          } else {
            showToast(result.message || "Failed to delete discovered job.", "error");
          }
        } catch (err) {
          showToast("Error deleting discovered job.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function renderApplications() {
    renderDiscoveredJobs();
    if (!applicationsTableContainer) return;

    const apps = (state.applications || []).filter(app => {
      // Show manual applications (no jobId)
      if (!app.jobId) return true;
      // For automated jobs, only show them if status has been updated from the initial discovery values
      return app.status !== "Not Applied" && app.status !== "Screen out";
    });

    if (apps.length === 0) {
      applicationsTableContainer.innerHTML = `
        <div class="list-empty">
          <p style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">No applications found.</p>
          <p class="muted">Add a job application using the form above to start tracking.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Role</th>
            <th>Job ID</th>
            <th>Job Link</th>
            <th>Added Date</th>
            <th>Updated Date</th>
            <th>Status</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    apps.forEach(app => {
      const addedDate = new Date(app.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
      const updatedDate = new Date(app.updatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      const jobIdHtml = app.jobId
        ? `<span style="font-family: 'JetBrains Mono', monospace; font-size:12.5px; color:var(--color-text-bright);">${app.jobId}</span>`
        : `<span class="muted" style="font-size:13.5px;">-</span>`;

      const jobLinkHtml = app.jobLink 
        ? `<a href="${app.jobLink}" target="_blank" class="accent-link" style="font-size: 13px;">View Job Link</a>`
        : `<span class="muted" style="font-size: 13px;">-</span>`;

      const statuses = ["Not Applied", "Applied", "Screen out", "Reached out", "Interviewing", "Selected", "Rejected", "Dropped", "Application Closed"];
      const statusClassMap = {
        "Not Applied": "status-not-applied",
        "Applied": "status-applied",
        "Screen out": "status-screen-out",
        "Reached out": "status-reached-out",
        "Interviewing": "status-interviewing",
        "Selected": "status-selected",
        "Rejected": "status-rejected",
        "Dropped": "status-dropped",
        "Application Closed": "status-closed"
      };
      
      const currentStatusClass = statusClassMap[app.status] || "status-not-applied";
      const cleanCompanyName = deduplicateText(app.companyName);
      const cleanRole = deduplicateText(app.role);

      let statusSelectOptions = statuses.map(s => {
        const selected = app.status === s ? "selected" : "";
        return `<option value="${s}" ${selected}>${s}</option>`;
      }).join("");

      const statusSelectHtml = `
        <select class="table-status-select ${currentStatusClass}" data-app-id="${app.id}">
          ${statusSelectOptions}
        </select>
      `;

      html += `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--color-text-bright); font-size:14.5px;">${cleanCompanyName}</div>
          </td>
          <td>
            <div style="font-weight: 500; font-size:13.5px; color:var(--color-text);">${cleanRole}</div>
          </td>
          <td>
            ${jobIdHtml}
          </td>
          <td>
            ${jobLinkHtml}
          </td>
          <td>
            <span style="font-size:13px; color:var(--color-text-muted);">${addedDate}</span>
          </td>
          <td>
            <span style="font-size:13px; color:var(--color-text-muted);">${updatedDate}</span>
          </td>
          <td>
            ${statusSelectHtml}
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-outline app-edit-btn" style="border-color: var(--color-primary); color: var(--color-primary); padding: 4px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; margin-right: 6px;" data-app-id="${app.id}" title="Edit Application" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn btn-outline app-delete-btn" style="border-color: var(--color-danger); color: var(--color-danger); padding: 4px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;" data-app-id="${app.id}" title="Delete Application" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
    applicationsTableContainer.innerHTML = html;
    attachStatusChangeListeners("applicationsTableContainer");

    // Attach delete listeners
    document.querySelectorAll("#applicationsTableContainer .app-delete-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const appId = button.getAttribute("data-app-id");
        const confirmed = await showConfirm("Are you sure you want to delete this application?");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/applications/${appId}`, {
            method: "DELETE"
          });
          const result = await res.json();
          if (result.success) {
            showToast("Application deleted successfully.");
            await fetchApplications();
            renderApplications();
          } else {
            showToast(result.message || "Failed to delete application.", "error");
          }
        } catch (err) {
          showToast("Error deleting application.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    // Attach edit listeners
    document.querySelectorAll("#applicationsTableContainer .app-edit-btn").forEach(button => {
      button.addEventListener("click", () => {
        const appId = button.getAttribute("data-app-id");
        startEditApplication(appId);
      });
    });
  }

  function startEditApplication(id) {
    const app = state.applications.find(a => a.id === id);
    if (!app) return;
    state.editingApplicationId = id;
    
    if (appCompanyName) appCompanyName.value = app.companyName;
    if (appRole) appRole.value = app.role;
    if (appJobId) appJobId.value = app.jobId || "";
    if (appJobLink) appJobLink.value = app.jobLink || "";
    
    if (appFormSubmitBtn) appFormSubmitBtn.innerText = "Save Application";
    if (cancelAppEditBtn) cancelAppEditBtn.style.display = "inline-flex";
  }

  function resetApplicationEditor() {
    state.editingApplicationId = null;
    if (appCompanyName) appCompanyName.value = "";
    if (appRole) appRole.value = "";
    if (appJobId) appJobId.value = "";
    if (appJobLink) appJobLink.value = "";
    
    if (appFormSubmitBtn) appFormSubmitBtn.innerText = "Add Application";
    if (cancelAppEditBtn) cancelAppEditBtn.style.display = "none";
  }

  function renderQueueTable() {
    if (!queueTableContainer) return;

    const query = (state.queueSearchQuery || "").toLowerCase().trim();
    const statusFilter = state.queueStatusFilter || "all";

    const filteredItems = (state.queue || []).filter(item => {
      const leadName = (item.lead.fullName || "").toLowerCase();
      const companyName = (item.lead.company.name || "").toLowerCase();
      const email = (item.candidate.email || "").toLowerCase();
      const matchesQuery = !query || leadName.includes(query) || companyName.includes(query) || email.includes(query);

      let matchesStatus = true;
      if (statusFilter === "paused") {
        matchesStatus = item.isPaused;
      } else if (statusFilter === "scheduled") {
        matchesStatus = !item.isPaused && item.status === "scheduled";
      } else if (statusFilter === "active") {
        matchesStatus = !item.isPaused && item.status !== "scheduled";
      }

      return matchesQuery && matchesStatus;
    });

    if (queueCountBadge) {
      queueCountBadge.innerText = `${filteredItems.length} ${filteredItems.length === 1 ? 'Lead' : 'Leads'}`;
    }

    if (filteredItems.length === 0) {
      queueTableContainer.innerHTML = `
        <div class="list-empty">
          <p style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">No matching leads found in queue.</p>
          <p class="muted">Try adjusting your search or filter criteria.</p>
        </div>
      `;
    } else {
      let html = `
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Email</th>
              <th>Stage</th>
              <th>Scheduled Time</th>
              <th>Settings</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
      `;

      filteredItems.forEach(campaign => {
        const formattedDate = campaign.scheduledFor 
          ? new Date(campaign.scheduledFor).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "-";

        let statusBadge = `<span class="badge-scheduled">Scheduled</span>`;
        let stageText = "Initial Outreach";

        if (campaign.isPaused) {
          statusBadge = `<span class="badge-bounce">Paused</span>`;
        } else if (campaign.status === "sent_initial") {
          statusBadge = `<span class="badge-sent">In-flight</span>`;
          stageText = `Followup ${campaign.followupCount} / ${campaign.maxFollowups}`;
        } else if (campaign.status.startsWith("sent_followup_")) {
          statusBadge = `<span class="badge-sent">In-flight</span>`;
          stageText = `Followup ${campaign.followupCount} / ${campaign.maxFollowups}`;
        } else if (campaign.status === "scheduled" && campaign.followupCount > 0) {
          stageText = `Followup ${campaign.followupCount} / ${campaign.maxFollowups}`;
        }

        const settingsText = `
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.04); color: var(--color-text-muted); border: 1px solid var(--border-color);">
            ${campaign.respectTiming ? "⏳ Timing" : "⚡ Direct"}
          </span>
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.04); color: var(--color-text-muted); border: 1px solid var(--border-color);">
            ${campaign.skipBounceMonitor ? "🛡️ Verified" : "🔎 Monitor"}
          </span>
        `;

        html += `
          <tr>
            <td>
              <div style="font-weight:600; color:var(--color-text-bright);">${campaign.lead.fullName}</div>
              <div class="muted" style="margin-top: 2px;">${campaign.lead.company.name}</div>
            </td>
            <td>
              <span style="font-family: 'JetBrains Mono', monospace; font-size:12.5px;">${campaign.candidate.email}</span>
            </td>
            <td>
              <div style="font-weight: 500; font-size: 13px; margin-bottom: 4px;">${stageText}</div>
              <div>${statusBadge}</div>
            </td>
            <td>
              <span>${formattedDate}</span>
            </td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">${settingsText}</div>
            </td>
            <td style="text-align: right;">
              <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                <button class="btn btn-outline queue-trigger-btn" data-campaign-id="${campaign.id}" type="button">
                  Trigger Now
                </button>
                <button class="btn btn-outline queue-pause-btn" data-lead-id="${campaign.leadId}" data-paused="${campaign.isPaused}" type="button">
                  ${campaign.isPaused ? "Resume" : "Pause"}
                </button>
                <button class="btn btn-outline queue-cancel-btn" style="border-color: var(--color-danger); color: var(--color-danger);" data-lead-id="${campaign.leadId}" type="button">
                  Cancel
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;
      queueTableContainer.innerHTML = html;

      // Attach lead queue listeners
      document.querySelectorAll("#queueTableContainer .queue-trigger-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const campaignId = button.getAttribute("data-campaign-id");
          button.disabled = true;
          button.innerText = "Triggering...";
          try {
            const res = await fetch(`/admin/queue/${campaignId}/trigger`, { method: "POST" });
            const result = await res.json();
            if (result.success) {
              showToast(`Campaign queue item triggered! Emails sent: ${result.sentCount}`);
              updateUI();
            } else {
              showToast(result.message || "Failed to trigger campaign.", "error");
            }
          } catch (e) {
            showToast("Error triggering campaign.", "error");
          } finally {
            button.disabled = false;
            button.innerText = "Trigger Now";
          }
        });
      });

      document.querySelectorAll("#queueTableContainer .queue-pause-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const leadId = button.getAttribute("data-lead-id");
          const currentPaused = button.getAttribute("data-paused") === "true";
          button.disabled = true;
          try {
            const res = await fetch(`/admin/leads/${leadId}/pause`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isPaused: !currentPaused })
            });
            const result = await res.json();
            if (result.success) {
              showToast(result.isPaused ? "Campaign paused successfully." : "Campaign resumed successfully!");
              updateUI();
            } else {
              showToast("Failed to change pause state.", "error");
            }
          } catch (e) {
            showToast("Failed to pause/resume campaign.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll("#queueTableContainer .queue-cancel-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const leadId = button.getAttribute("data-lead-id");
          const confirmed = await showConfirm("Are you sure you want to cancel this campaign and remove it from the queue?");
          if (!confirmed) return;
          button.disabled = true;
          try {
            const res = await fetch(`/admin/leads/${leadId}/cancel`, { method: "POST" });
            const result = await res.json();
            if (result.success) {
              showToast("Campaign cancelled successfully.");
              updateUI();
            } else {
              showToast("Failed to cancel campaign.", "error");
            }
          } catch (e) {
            showToast("Failed to cancel campaign.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    // Now render Company-wise Outbox
    renderCompanyQueueTable();
  }

  function renderCompanyQueueTable() {
    if (!companyQueueTableContainer) return;

    const companyGroups = {};
    (state.queue || []).forEach(item => {
      const company = item.lead.company;
      if (!company) return;

      if (!companyGroups[company.id]) {
        companyGroups[company.id] = {
          id: company.id,
          name: company.name,
          items: []
        };
      }
      companyGroups[company.id].items.push(item);
    });

    const companyQueueList = Object.values(companyGroups).map(group => {
      const total = group.items.length;
      const paused = group.items.filter(item => item.isPaused).length;
      const active = group.items.filter(item => !item.isPaused && item.status !== "scheduled").length;
      const scheduled = group.items.filter(item => !item.isPaused && item.status === "scheduled").length;

      let earliestScheduled = null;
      group.items.forEach(item => {
        if (item.scheduledFor) {
          const d = new Date(item.scheduledFor);
          if (!earliestScheduled || d < earliestScheduled) {
            earliestScheduled = d;
          }
        }
      });

      return {
        id: group.id,
        name: group.name,
        total,
        paused,
        active,
        scheduled,
        earliestScheduled
      };
    });

    const compQuery = (state.companyQueueSearchQuery || "").toLowerCase().trim();
    const compStatusFilter = state.companyQueueStatusFilter || "all";

    const filteredCompanies = companyQueueList.filter(comp => {
      const matchesQuery = !compQuery || comp.name.toLowerCase().includes(compQuery);

      let matchesStatus = true;
      if (compStatusFilter === "paused") {
        matchesStatus = comp.paused > 0;
      } else if (compStatusFilter === "scheduled") {
        matchesStatus = comp.scheduled > 0;
      } else if (compStatusFilter === "active") {
        matchesStatus = comp.active > 0;
      }

      return matchesQuery && matchesStatus;
    });

    if (companyQueueCountBadge) {
      companyQueueCountBadge.innerText = `${filteredCompanies.length} ${filteredCompanies.length === 1 ? 'Company' : 'Companies'}`;
    }

    if (filteredCompanies.length === 0) {
      companyQueueTableContainer.innerHTML = `
        <div class="list-empty">
          <p style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">No matching companies found in queue.</p>
          <p class="muted">Try adjusting your search or filter criteria.</p>
        </div>
      `;
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Outbox Stats</th>
            <th>Earliest Scheduled Time</th>
            <th style="text-align: right;">Bulk Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    filteredCompanies.forEach(comp => {
      const formattedDate = comp.earliestScheduled
        ? new Date(comp.earliestScheduled).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "-";

      const statChips = `
        <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(99, 102, 241, 0.08); color: var(--color-primary-hover); border: 1px solid rgba(99, 102, 241, 0.15);">
          ${comp.total} Total
        </span>
        ${comp.scheduled > 0 ? `
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.08); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.15);">
            ${comp.scheduled} Scheduled
          </span>
        ` : ""}
        ${comp.active > 0 ? `
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.08); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.15);">
            ${comp.active} In-flight
          </span>
        ` : ""}
        ${comp.paused > 0 ? `
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.08); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.15);">
            ${comp.paused} Paused
          </span>
        ` : ""}
      `;

      let pauseResumeBtn = "";
      if (comp.paused < comp.total) {
        pauseResumeBtn = `
          <button class="btn btn-outline company-pause-btn" data-company-id="${comp.id}" data-action="pause" type="button">
            Pause All
          </button>
        `;
      } else {
        pauseResumeBtn = `
          <button class="btn btn-outline company-pause-btn" data-company-id="${comp.id}" data-action="resume" type="button">
            Resume All
          </button>
        `;
      }

      html += `
        <tr>
          <td>
            <div style="font-weight:600; color:var(--color-text-bright);">${comp.name}</div>
          </td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">${statChips}</div>
          </td>
          <td>
            <span>${formattedDate}</span>
          </td>
          <td style="text-align: right;">
            <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
              <button class="btn btn-outline company-trigger-btn" data-company-id="${comp.id}" type="button">
                Trigger All
              </button>
              ${pauseResumeBtn}
              <button class="btn btn-outline company-cancel-btn" style="border-color: var(--color-danger); color: var(--color-danger);" data-company-id="${comp.id}" type="button">
                Cancel All
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
    companyQueueTableContainer.innerHTML = html;

    // Attach company bulk action listeners
    document.querySelectorAll("#companyQueueTableContainer .company-trigger-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const companyId = button.getAttribute("data-company-id");
        button.disabled = true;
        button.innerText = "Triggering...";
        try {
          const res = await fetch(`/admin/companies/${companyId}/trigger-outbox`, { method: "POST" });
          const result = await res.json();
          if (result.success) {
            showToast(`Company campaign queue triggered! Emails sent: ${result.sentCount}`);
            updateUI();
          } else {
            showToast(result.message || "Failed to trigger company campaign.", "error");
          }
        } catch (e) {
          showToast("Error triggering company campaign.", "error");
        } finally {
          button.disabled = false;
          button.innerText = "Trigger All";
        }
      });
    });

    document.querySelectorAll("#companyQueueTableContainer .company-pause-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const companyId = button.getAttribute("data-company-id");
        const action = button.getAttribute("data-action");
        const isPaused = action === "pause";
        button.disabled = true;
        try {
          const res = await fetch(`/admin/companies/${companyId}/pause`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isPaused })
          });
          const result = await res.json();
          if (result.success) {
            showToast(isPaused ? `Paused ${result.count} campaigns.` : `Resumed ${result.count} campaigns!`);
            updateUI();
          } else {
            showToast("Failed to pause/resume campaigns.", "error");
          }
        } catch (e) {
          showToast("Error toggling pause state.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("#companyQueueTableContainer .company-cancel-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const companyId = button.getAttribute("data-company-id");
        const confirmed = await showConfirm("Are you sure you want to cancel all campaign sequences for this company?");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/companies/${companyId}/cancel`, { method: "POST" });
          const result = await res.json();
          if (result.success) {
            showToast(`Cancelled ${result.count} campaigns successfully.`);
            updateUI();
          } else {
            showToast("Failed to cancel campaigns.", "error");
          }
        } catch (e) {
          showToast("Error cancelling campaigns.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  // Core Rendering Functions
  function renderMetrics() {
    if (!metricsSection) return;
    const {
      leadCount = 0,
      activeCampaignsCount = 0,
      bouncesCount = 0,
      repliesCount = 0,
      eventCount = 0
    } = state.summary;

    metricsSection.innerHTML = `
      <div class="metric-card">
        <span class="label">Total Leads</span>
        <span class="value">${leadCount}</span>
        <span class="subtext">Total outreach targets</span>
      </div>
      <div class="metric-card">
        <span class="label">Active Sequences</span>
        <span class="value text-primary">${activeCampaignsCount}</span>
        <span class="subtext">Followups pending</span>
      </div>
      <div class="metric-card">
        <span class="label">Total Bounces</span>
        <span class="value text-danger">${bouncesCount}</span>
        <span class="subtext">Mailer Bounces stopped</span>
      </div>
      <div class="metric-card">
        <span class="label">Replies Received</span>
        <span class="value text-success">${repliesCount}</span>
        <span class="subtext">Outreach responses</span>
      </div>
      <div class="metric-card">
        <span class="label">Logs & Actions</span>
        <span class="value">${eventCount}</span>
        <span class="subtext">Outbound activities</span>
      </div>
    `;
  }

  function getFilteredLeads() {
    const searchQuery = leadsSearchInput ? leadsSearchInput.value.toLowerCase().trim() : "";
    const statusFilter = state.leadsStatusFilter;
    const companyFilter = state.leadsCompanyFilter;

    return state.leads.filter(lead => {
      // 1. Search filter (name, company, email, or tags)
      const matchesSearch = !searchQuery || 
        lead.fullName.toLowerCase().includes(searchQuery) ||
        lead.company.name.toLowerCase().includes(searchQuery) ||
        lead.candidates.some(c => c.email.toLowerCase().includes(searchQuery)) ||
        (lead.tags && lead.tags.some(t => t.toLowerCase().includes(searchQuery)));

      if (!matchesSearch) return false;

      // 2. Company filter
      if (companyFilter !== "all" && lead.company.name !== companyFilter) {
        return false;
      }

      // 3. Status filter
      const campaign = lead.campaignState;
      if (statusFilter === "all") return true;
      if (statusFilter === "draft") return !campaign || campaign.status === "draft";
      if (!campaign) return false;

      if (statusFilter === "active") {
        return ["sent_initial", "sent_followup_1", "sent_followup_2", "sent_followup_3", "sent_followup_4", "sent_followup_5", "sent_followup_6", "sent_followup_7", "sent_followup_8", "sent_followup_9", "sent_followup_10"].includes(campaign.status) && !campaign.isPaused;
      }
      if (statusFilter === "scheduled") {
        return campaign.status === "scheduled" && !campaign.isPaused;
      }
      if (statusFilter === "paused") {
        return campaign.isPaused;
      }

      return campaign.status === statusFilter;
    });
  }

  function renderLeadsTable() {
    if (!leadsTableContainer) return;

    const filteredLeads = getFilteredLeads();
    const totalLeads = filteredLeads.length;
    const totalPages = Math.ceil(totalLeads / leadsPageSize) || 1;

    // Boundary check for current page
    if (leadsCurrentPage > totalPages) {
      leadsCurrentPage = totalPages;
    }
    if (leadsCurrentPage < 1) {
      leadsCurrentPage = 1;
    }

    // Update pagination controls UI elements
    if (leadsPageInfo) {
      leadsPageInfo.innerText = `Page ${leadsCurrentPage} of ${totalPages} (${totalLeads} total)`;
    }
    if (leadsPrevPageBtn) {
      leadsPrevPageBtn.disabled = leadsCurrentPage === 1;
    }
    if (leadsNextPageBtn) {
      leadsNextPageBtn.disabled = leadsCurrentPage === totalPages;
    }

    // Generate unique companies list from state.leads (unfiltered) to populate the company filter dropdown
    const uniqueCompanies = Array.from(new Set(state.leads.map(l => l.company.name))).sort();
    
    let companyOptionsHtml = `<option value="all">Company (All)</option>`;
    uniqueCompanies.forEach(comp => {
      const selectedAttr = state.leadsCompanyFilter === comp ? "selected" : "";
      companyOptionsHtml += `<option value="${comp}" ${selectedAttr}>${comp}</option>`;
    });

    const statusOptions = [
      { value: "all", label: "Status (All)" },
      { value: "draft", label: "Inactive" },
      { value: "scheduled", label: "Scheduled" },
      { value: "active", label: "Active" },
      { value: "paused", label: "Paused" },
      { value: "bounced", label: "Bounced" },
      { value: "replied", label: "Replied" },
      { value: "cancelled", label: "Cancelled" },
      { value: "completed", label: "Completed" }
    ];

    let statusOptionsHtml = "";
    statusOptions.forEach(opt => {
      const selectedAttr = state.leadsStatusFilter === opt.value ? "selected" : "";
      statusOptionsHtml += `<option value="${opt.value}" ${selectedAttr}>${opt.label}</option>`;
    });

    let html = `
      <table>
        <thead>
          <tr>
            <th>Lead</th>
            <th>
              <select id="leadsCompanyFilterHeader" class="header-filter-select">
                ${companyOptionsHtml}
              </select>
            </th>
            <th>Email</th>
            <th>
              <select id="leadsStatusFilterHeader" class="header-filter-select">
                ${statusOptionsHtml}
              </select>
            </th>
            <th>Next Step</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (totalLeads === 0) {
      html += `
        <tr>
          <td colspan="6">
            <div class="list-empty" style="padding: 32px 0;">
              <p style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">No matching leads found.</p>
              <p class="muted">Adjust your search or header filters.</p>
            </div>
          </td>
        </tr>
      `;
    } else {
      // Paginate subset
      const startIndex = (leadsCurrentPage - 1) * leadsPageSize;
      const paginatedLeads = filteredLeads.slice(startIndex, startIndex + leadsPageSize);

      paginatedLeads.forEach(lead => {
        const formattedDate = new Date(lead.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });

        // Find selected candidate email
        const selectedCandidate = lead.candidates.find(c => c.selected) || lead.candidates[0];
        const targetEmail = selectedCandidate ? selectedCandidate.email : "No email resolved";
        
        // Determine campaign status badge
        const campaign = lead.campaignState;
        let statusBadge = `<span class="badge-draft">Inactive</span>`;
        let nextActionText = `<span class="muted">-</span>`;

        if (campaign) {
          if (campaign.isPaused) {
            statusBadge = `<span class="badge-bounce">Paused</span>`;
            nextActionText = `<span class="text-warning" style="font-size: 12.5px;">Outreach paused</span>`;
          } else if (campaign.status === "scheduled") {
            statusBadge = `<span class="badge-scheduled">Scheduled</span>`;
            const schedDate = new Date(campaign.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            nextActionText = `<span style="font-size: 12.5px;">Initial mail at ${schedDate}</span>`;
          } else if (campaign.status === "sent_initial") {
            statusBadge = `<span class="badge-sent">Initial Sent</span>`;
            const schedDate = new Date(campaign.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            nextActionText = `<span class="text-primary" style="font-size: 12.5px;">Followup 1 on ${schedDate}</span>`;
          } else if (campaign.status === "sent_followup_1") {
            statusBadge = `<span class="badge-sent">Followup 1</span>`;
            const schedDate = new Date(campaign.scheduledFor).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            nextActionText = `<span class="text-primary" style="font-size: 12.5px;">Followup 2 on ${schedDate}</span>`;
          } else if (campaign.status === "completed") {
            statusBadge = `<span class="badge-sent" style="background: var(--color-success-bg); color: var(--color-success);">Completed</span>`;
            nextActionText = `<span class="muted" style="font-size: 12.5px;">Sequence finished</span>`;
          } else if (campaign.status === "cancelled") {
            statusBadge = `<span class="badge-draft" style="background: var(--color-danger-bg); color: var(--color-danger);">Cancelled</span>`;
            nextActionText = `<span class="muted" style="font-size: 12.5px;">Outreach cancelled</span>`;
          } else if (campaign.status === "bounced") {
            statusBadge = `<span class="badge-bounce">Bounced</span>`;
            nextActionText = `<span class="text-danger" style="font-size: 12.5px;">Halted automatically</span>`;
          } else if (campaign.status === "replied") {
            statusBadge = `<span class="badge-replied">Replied</span>`;
            nextActionText = `<span style="color: #c084fc; font-size: 12.5px;">Outreach converted</span>`;
          }
        }

        let primaryBtnHtml = "";
        if (!campaign) {
          primaryBtnHtml = `
            <button class="btn btn-accent launch-campaign-btn" data-lead-id="${lead.id}" type="button">
              Launch Sequence
            </button>
          `;
        } else if (["scheduled", "sent_initial", "sent_followup_1", "sent_followup_2", "sent_followup_3", "sent_followup_4", "sent_followup_5", "sent_followup_6", "sent_followup_7", "sent_followup_8", "sent_followup_9", "sent_followup_10"].includes(campaign.status)) {
          primaryBtnHtml = `
            <button class="btn btn-outline pause-lead-btn" data-lead-id="${lead.id}" data-paused="${campaign.isPaused}" type="button">
              ${campaign.isPaused ? "Resume" : "Pause"}
            </button>
          `;
        } else {
          primaryBtnHtml = `
            <button class="btn btn-outline launch-campaign-btn" data-lead-id="${lead.id}" type="button">
              Reconfigure
            </button>
          `;
        }

        let tagsHtml = "";
        if (lead.tags && lead.tags.length > 0) {
          tagsHtml = `
            <div style="margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap;">
              ${lead.tags.map(tag => `<span class="badge-tag" style="background: rgba(167, 139, 250, 0.08); color: #c084fc; border: 1px solid rgba(167, 139, 250, 0.15); font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 500; display: inline-block;">${tag}</span>`).join("")}
            </div>
          `;
        }

        html += `
          <tr>
            <td>
              <div style="font-weight:600; color:var(--color-text-bright);">${lead.fullName}</div>
              ${tagsHtml}
              <div class="muted" style="margin-top: 2px;">Captured ${formattedDate}</div>
            </td>
            <td>
              <div style="font-weight:600; color:var(--color-text-bright);">${lead.company.name}</div>
            </td>
            <td>
              <span style="font-family: 'JetBrains Mono', monospace; font-size: 12.5px;">${targetEmail}</span>
            </td>
            <td>${statusBadge}</td>
            <td>${nextActionText}</td>
            <td style="text-align: right;">
              <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                ${primaryBtnHtml}
                <button class="btn btn-outline edit-lead-btn" data-lead-id="${lead.id}" data-lead-name="${escHtml(lead.fullName)}" data-lead-company="${escHtml(lead.company.name)}" data-lead-email="${escHtml(targetEmail)}" data-lead-tags="${escHtml((lead.tags || []).join(', '))}" type="button" style="padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; height: 34px; width: 34px;" title="Edit Lead">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit-2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                </button>
                <div class="actions-dropdown-container">
                  <button class="btn btn-outline dropdown-toggle-btn" type="button">⋮</button>
                  <div class="actions-dropdown-menu">
                    ${campaign ? `
                      <button class="dropdown-item launch-campaign-btn" data-lead-id="${lead.id}" type="button">⚙️ Reconfigure</button>
                    ` : ""}
                    ${campaign && ["scheduled", "sent_initial", "sent_followup_1", "sent_followup_2", "sent_followup_3", "sent_followup_4", "sent_followup_5", "sent_followup_6", "sent_followup_7", "sent_followup_8", "sent_followup_9", "sent_followup_10"].includes(campaign.status) ? `
                      ${campaign.isPaused ? `
                        <button class="dropdown-item pause-lead-btn" data-lead-id="${lead.id}" data-paused="${campaign.isPaused}" type="button">▶️ Resume Sequence</button>
                      ` : `
                        <button class="dropdown-item pause-lead-btn" data-lead-id="${lead.id}" data-paused="${campaign.isPaused}" type="button">⏸️ Pause Sequence</button>
                      `}
                      <button class="dropdown-item end-lead-btn" data-lead-id="${lead.id}" type="button">🛑 End Sequence</button>
                      <button class="dropdown-item cancel-lead-btn" data-lead-id="${lead.id}" type="button">⚠️ Cancel Sequence</button>
                    ` : ""}
                    <button class="dropdown-item bulk-outreach-btn" data-company-id="${lead.company.id}" data-company-name="${lead.company.name}" type="button">🏢 Company Campaign</button>
                    ${lead.tags && lead.tags.length > 0 ? lead.tags.map(tag => `
                      <button class="dropdown-item bulk-outreach-tag-btn" data-tag="${tag}" type="button">🏷️ Tag Campaign: ${tag}</button>
                    `).join("") : ""}
                    <button class="dropdown-item delete-lead-btn danger-item" data-lead-id="${lead.id}" type="button">🗑️ Delete Lead</button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      });
    }

    html += `
        </tbody>
      </table>
    `;
    leadsTableContainer.innerHTML = html;

    // Attach listener to company filter select inside the table header
    const companySelect = document.getElementById("leadsCompanyFilterHeader");
    if (companySelect) {
      companySelect.addEventListener("change", (e) => {
        state.leadsCompanyFilter = e.target.value;
        leadsCurrentPage = 1;
        renderLeadsTable();
      });
    }

    // Attach listener to status filter select inside the table header
    const statusSelect = document.getElementById("leadsStatusFilterHeader");
    if (statusSelect) {
      statusSelect.addEventListener("change", (e) => {
        state.leadsStatusFilter = e.target.value;
        leadsCurrentPage = 1;
        renderLeadsTable();
      });
    }

    // Attach listeners to dropdown toggles
    document.querySelectorAll("#leadsTableContainer .dropdown-toggle-btn").forEach(button => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        const container = button.closest(".actions-dropdown-container");
        document.querySelectorAll(".actions-dropdown-container").forEach(c => {
          if (c !== container) c.classList.remove("open");
        });
        container.classList.toggle("open");
      });
    });

    // Attach listeners to active buttons
    document.querySelectorAll("#leadsTableContainer .launch-campaign-btn").forEach(button => {
      button.addEventListener("click", () => {
        const leadId = button.getAttribute("data-lead-id");
        openCampaignModal(leadId);
      });
    });

    document.querySelectorAll("#leadsTableContainer .bulk-outreach-btn").forEach(button => {
      button.addEventListener("click", () => {
        const companyId = button.getAttribute("data-company-id");
        const companyName = button.getAttribute("data-company-name");
        openBulkCampaignModal(companyId, companyName);
      });
    });

    document.querySelectorAll("#leadsTableContainer .bulk-outreach-tag-btn").forEach(button => {
      button.addEventListener("click", () => {
        const tag = button.getAttribute("data-tag");
        openBulkTagCampaignModal(tag);
      });
    });

    document.querySelectorAll("#leadsTableContainer .pause-lead-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const leadId = button.getAttribute("data-lead-id");
        const currentPaused = button.getAttribute("data-paused") === "true";
        button.disabled = true;
        
        try {
          const res = await fetch(`/admin/leads/${leadId}/pause`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isPaused: !currentPaused })
          });
          const result = await res.json();
          if (result.success) {
            showToast(result.isPaused ? "Campaign paused successfully." : "Campaign resumed successfully!");
            updateUI();
          } else {
            showToast("Failed to change pause state.", "error");
          }
        } catch (e) {
          showToast("Failed to pause/resume campaign.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("#leadsTableContainer .end-lead-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const leadId = button.getAttribute("data-lead-id");
        const confirmed = await showConfirm("Are you sure you want to end this campaign sequence?");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/leads/${leadId}/end`, { method: "POST" });
          const result = await res.json();
          if (result.success) {
            showToast("Campaign ended successfully.");
            updateUI();
          } else {
            showToast("Failed to end campaign.", "error");
          }
        } catch (e) {
          showToast("Request failed.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("#leadsTableContainer .cancel-lead-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const leadId = button.getAttribute("data-lead-id");
        const confirmed = await showConfirm("Are you sure you want to cancel this campaign sequence?");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/leads/${leadId}/cancel`, { method: "POST" });
          const result = await res.json();
          if (result.success) {
            showToast("Campaign cancelled successfully.");
            updateUI();
          } else {
            showToast("Failed to cancel campaign.", "error");
          }
        } catch (e) {
          showToast("Request failed.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("#leadsTableContainer .delete-lead-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const leadId = button.getAttribute("data-lead-id");
        const confirmed = await showConfirm("Are you sure you want to delete this lead completely? This will wipe all associated email candidates, events, and campaign logs.");
        if (!confirmed) return;
        button.disabled = true;
        try {
          const res = await fetch(`/admin/leads/${leadId}`, { method: "DELETE" });
          const result = await res.json();
          if (result.success) {
            showToast("Lead deleted successfully!");
            updateUI();
          } else {
            showToast("Failed to delete lead.", "error");
          }
        } catch (e) {
          showToast("Request failed.", "error");
        } finally {
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll("#leadsTableContainer .edit-lead-btn").forEach(button => {
      button.addEventListener("click", () => {
        const leadId = button.getAttribute("data-lead-id");
        const leadName = button.getAttribute("data-lead-name");
        const leadCompany = button.getAttribute("data-lead-company");
        const leadEmail = button.getAttribute("data-lead-email");
        const leadTags = button.getAttribute("data-lead-tags");

        if (editLeadId) editLeadId.value = leadId;
        if (editLeadFullName) editLeadFullName.value = leadName;
        if (editLeadCompany) editLeadCompany.value = leadCompany;
        if (editLeadEmail) editLeadEmail.value = leadEmail;
        if (editLeadTags) editLeadTags.value = leadTags;

        if (editLeadModal) editLeadModal.classList.add("show");
      });
    });
  }

  function renderTimelineLogs() {
    if (!eventsLogTimeline) return;

    if (state.events.length === 0) {
      eventsLogTimeline.innerHTML = `
        <div class="timeline-empty">
          <p>No activity logged yet. When campaigns run, timelines display here.</p>
        </div>
      `;
      return;
    }

    let html = "";
    state.events.forEach(ev => {
      const time = new Date(ev.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const date = new Date(ev.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      
      let badgeClass = "badge-sent";
      if (ev.eventType === "bounce") badgeClass = "badge-bounce";
      if (ev.eventType === "reply") badgeClass = "badge-replied";
      if (ev.eventType === "complaint") badgeClass = "badge-bounce";
      
      const recipient = ev.candidate?.email || "unknown";
      const leadName = ev.candidate?.lead?.fullName || "Lead";
      const payload = ev.rawPayload || {};

      let logText = "";
      if (ev.eventType === "delivery") {
        const stepName = payload.followupNumber === 0 ? "Initial Email" : `Followup #${payload.followupNumber}`;
        logText = `Dispatched outreach message (<strong>${stepName}</strong>) to <strong>${leadName}</strong> (${recipient})`;
      } else if (ev.eventType === "bounce") {
        logText = `Outreach bounce caught from <strong>${recipient}</strong>. Halting campaign state instantly.`;
      } else if (ev.eventType === "reply") {
        logText = `Outreach reply received from <strong>${leadName}</strong> (${recipient}). Conversion complete!`;
      } else {
        logText = `Email alert logged: ${ev.eventType} for ${recipient}`;
      }

      html += `
        <div class="event-row">
          <span class="event-time">${date} ${time}</span>
          <span class="${badgeClass} event-badge">${ev.eventType}</span>
          <span class="event-text">${logText}</span>
          <span class="event-provider">via ${ev.provider}</span>
        </div>
      `;
    });

    eventsLogTimeline.innerHTML = html;
  }

  function renderCompaniesList() {
    if (!companiesList) return;

    const searchEl  = document.getElementById("campaignsSearch");
    const filterEl  = document.getElementById("campaignsStatusFilter");
    const sortEl    = document.getElementById("campaignsSortBy");
    const countEl   = document.getElementById("campaignsCount");

    // Wire toolbar controls once (clone trick to avoid stacking listeners)
    function wireToolbar() {
      [searchEl, filterEl, sortEl].forEach(el => {
        if (!el || el.dataset.wired) return;
        el.dataset.wired = "1";
        el.addEventListener("input",  () => applyAndRender());
        el.addEventListener("change", () => applyAndRender());
      });
    }

    function applyAndRender() {
      const query      = (searchEl?.value || "").toLowerCase().trim();
      const statusFilter = filterEl?.value || "all";
      const sortBy     = sortEl?.value || "name-asc";

      let companies = [...state.companies];

      // ── Search ────────────────────────────────────────────────────────────
      if (query) {
        companies = companies.filter(c =>
          c.name.toLowerCase().includes(query) ||
          (c.domain && c.domain.toLowerCase().includes(query))
        );
      }

      // ── Status Filter ─────────────────────────────────────────────────────
      if (statusFilter === "active") {
        companies = companies.filter(c => c.startedCampaignCount > 0 && c.pausedCampaignCount < c.startedCampaignCount);
      } else if (statusFilter === "paused") {
        companies = companies.filter(c => c.startedCampaignCount > 0 && c.pausedCampaignCount === c.startedCampaignCount);
      } else if (statusFilter === "no-campaign") {
        companies = companies.filter(c => c.startedCampaignCount === 0);
      }

      // ── Sort ──────────────────────────────────────────────────────────────
      companies.sort((a, b) => {
        if (sortBy === "name-asc")    return a.name.localeCompare(b.name);
        if (sortBy === "name-desc")   return b.name.localeCompare(a.name);
        if (sortBy === "leads-desc")  return (b._count?.leads || 0) - (a._count?.leads || 0);
        if (sortBy === "leads-asc")   return (a._count?.leads || 0) - (b._count?.leads || 0);
        if (sortBy === "updated")     return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        return 0;
      });

      // ── Count badge ───────────────────────────────────────────────────────
      if (countEl) {
        countEl.textContent = `${companies.length} ${companies.length === 1 ? "company" : "companies"}`;
      }

      // ── Render rows ───────────────────────────────────────────────────────
      if (companies.length === 0) {
        companiesList.innerHTML = `
          <div class="list-empty">
            <p class="muted">${state.companies.length === 0 ? "No companies registered yet." : "No companies match your search or filters."}</p>
          </div>
        `;
        return;
      }

      const statusBadge = c => {
        if (c.startedCampaignCount === 0) return `<span class="campaign-status-badge badge-no-campaign">No Campaign</span>`;
        if (c.pausedCampaignCount === c.startedCampaignCount) return `<span class="campaign-status-badge badge-paused">Paused</span>`;
        return `<span class="campaign-status-badge badge-active">Active</span>`;
      };

      companiesList.innerHTML = companies.map(company => {
        const hasActiveCampaigns = company.startedCampaignCount > 0;
        const allPaused = hasActiveCampaigns && company.pausedCampaignCount === company.startedCampaignCount;
        return `
          <div class="company-row">
            <div class="company-info">
              <div class="company-row-top">
                <strong class="company-name-text">${company.name}</strong>
                ${statusBadge(company)}
              </div>
              <div class="company-row-sub">
                <span class="company-domain-text">${company.domain || "no domain"}</span>
                <span class="company-stats-text">
                  ${company._count?.leads || 0} lead${(company._count?.leads || 0) !== 1 ? "s" : ""}
                  &bull; ${company.startedCampaignCount} active campaign${company.startedCampaignCount !== 1 ? "s" : ""}
                  ${company.startedCampaignCount > 0 ? `&bull; ${company.pausedCampaignCount} paused` : ""}
                </span>
              </div>
            </div>
            <div class="company-actions">
              ${hasActiveCampaigns ? `
                ${allPaused ? `
                  <button class="btn btn-outline resume-company-btn btn-success" data-company-id="${company.id}" type="button">Resume All</button>
                ` : `
                  <button class="btn btn-outline pause-company-btn btn-warning" data-company-id="${company.id}" type="button">Pause All</button>
                `}
                <button class="btn btn-outline cancel-company-btn btn-danger" data-company-id="${company.id}" type="button">Cancel All</button>
              ` : `
                ${(company._count?.leads || 0) > 0 ? `
                  <button class="btn btn-accent bulk-outreach-btn" data-company-id="${company.id}" data-company-name="${company.name}">
                    🚀 Start Campaign
                  </button>
                ` : `
                  <button class="btn btn-outline delete-company-btn btn-danger" data-company-id="${company.id}" data-company-name="${company.name}" type="button">
                    🗑️ Delete
                  </button>
                `}
              `}
            </div>
          </div>
        `;
      }).join("");

      // ── Re-attach button listeners ─────────────────────────────────────────
      document.querySelectorAll(".bulk-outreach-btn").forEach(button => {
        button.addEventListener("click", () => {
          const companyId = button.getAttribute("data-company-id");
          const companyName = button.getAttribute("data-company-name");
          openBulkCampaignModal(companyId, companyName);
        });
      });

      document.querySelectorAll(".pause-company-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const companyId = button.getAttribute("data-company-id");
          button.disabled = true;
          try {
            const res = await fetch(`/admin/companies/${companyId}/pause`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isPaused: true })
            });
            const result = await res.json();
            if (result.success) {
              showToast(`Paused all campaigns for this company! (${result.count} campaigns)`);
              updateUI();
            } else {
              showToast("Failed to pause company campaigns.", "error");
            }
          } catch (e) {
            showToast("Request failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll(".resume-company-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const companyId = button.getAttribute("data-company-id");
          button.disabled = true;
          try {
            const res = await fetch(`/admin/companies/${companyId}/pause`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isPaused: false })
            });
            const result = await res.json();
            if (result.success) {
              showToast(`Resumed all campaigns for this company! (${result.count} campaigns)`);
              updateUI();
            } else {
              showToast("Failed to resume company campaigns.", "error");
            }
          } catch (e) {
            showToast("Request failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll(".cancel-company-btn").forEach(button => {
        button.addEventListener("click", async () => {
          const companyId = button.getAttribute("data-company-id");
          const confirmed = await showConfirm("Are you sure you want to cancel all campaigns for this company?");
          if (!confirmed) return;
          button.disabled = true;
          try {
            const res = await fetch(`/admin/companies/${companyId}/cancel`, { method: "POST" });
            const result = await res.json();
            if (result.success) {
              showToast(`Cancelled campaigns for this company! (${result.count} campaigns)`);
              updateUI();
            } else {
              showToast("Failed to cancel company campaigns.", "error");
            }
          } catch (e) {
            showToast("Request failed.", "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      document.querySelectorAll(".delete-company-btn").forEach(button => {
        button.addEventListener("click", () => {
          const companyId = button.getAttribute("data-company-id");
          const companyName = button.getAttribute("data-company-name");
          deleteCompany(companyId, companyName);
        });
      });
    }

    wireToolbar();
    applyAndRender();
  }

  async function deleteCompany(companyId, companyName) {
    const confirmed = await showConfirm(`Are you sure you want to permanently delete the company "${companyName}"? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/admin/companies/${companyId}`, {
        method: "DELETE"
      });
      const result = await res.json();
      if (res.ok && (result.success || result.message === "Company deleted successfully")) {
        showToast(`Company "${companyName}" deleted successfully!`);
        await updateUI();
        renderCompaniesList();
        
        if (selectedCompanyInsightId === companyId) {
          selectedCompanyInsightId = null;
          const emptyState = document.getElementById("companyDetailEmptyState");
          const detailContent = document.getElementById("companyDetailContent");
          if (emptyState && detailContent) {
            emptyState.style.display = "flex";
            detailContent.style.display = "none";
          }
        }
        renderCompanyInsightsTab();
      } else {
        showToast(result.message || "Failed to delete company.", "error");
      }
    } catch (err) {
      console.error("Failed to delete company:", err);
      showToast("Request failed: " + err.message, "error");
    }
  }

  // ─── COMPANY INSIGHTS CONSOLE ───────────────────────────────────────────────

  let selectedCompanyInsightId = null;

  function renderCompanyInsightsTab() {
    const listEl = document.getElementById("companyInsightsList");
    if (!listEl) return;

    const searchInput = document.getElementById("companyInsightsSearch");

    function renderList(filter = "") {
      const normalized = filter.toLowerCase().trim();
      const filtered = normalized
        ? state.companies.filter(c =>
            c.name.toLowerCase().includes(normalized) ||
            (c.domain && c.domain.toLowerCase().includes(normalized))
          )
        : state.companies;

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="list-empty">
            <p class="muted">${normalized ? "No companies match your search." : "No companies in database yet."}</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = filtered.map(company => `
        <div class="company-insight-row ${selectedCompanyInsightId === company.id ? "selected" : ""}"
             data-company-id="${company.id}" role="button" tabindex="0">
          <div class="cir-main">
            <span class="cir-name">${company.name}</span>
            <span class="cir-domain">${company.domain || "—"}</span>
          </div>
          <div class="cir-stats">
            <span class="cir-stat-pill">${company._count?.leads || 0} leads</span>
          </div>
        </div>
      `).join("");

      listEl.querySelectorAll(".company-insight-row").forEach(row => {
        const openDetail = () => {
          const cid = row.getAttribute("data-company-id");
          selectedCompanyInsightId = cid;
          renderList(searchInput ? searchInput.value : "");
          loadAndRenderCompanyDetail(cid);
        };
        row.addEventListener("click", openDetail);
        row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openDetail(); });
      });
    }

    renderList();

    if (searchInput) {
      // Re-bind search to avoid duplicate listeners
      const newSearch = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearch, searchInput);
      newSearch.addEventListener("input", e => renderList(e.target.value));
    }

    // If a company was previously selected, re-load its detail
    if (selectedCompanyInsightId) {
      loadAndRenderCompanyDetail(selectedCompanyInsightId);
    }
  }

  async function loadAndRenderCompanyDetail(companyId) {
    const emptyState = document.getElementById("companyDetailEmptyState");
    const detailContent = document.getElementById("companyDetailContent");
    if (!emptyState || !detailContent) return;

    // Show loading state
    emptyState.style.display = "none";
    detailContent.style.display = "block";
    detailContent.innerHTML = `<div class="company-detail-loading"><span class="spinner"></span> Loading insights...</div>`;

    try {
      const res = await fetch(`/admin/companies/${companyId}/insights`);
      if (!res.ok) throw new Error("Failed to load insights");
      const data = await res.json();
      renderCompanyDetail(data);
    } catch (e) {
      detailContent.innerHTML = `<div class="company-detail-error">⚠️ Failed to load company insights. <button class="btn btn-outline btn-compact" onclick="loadAndRenderCompanyDetail('${companyId}')">Retry</button></div>`;
    }
  }

  function renderCompanyDetail(data) {
    const detailContent = document.getElementById("companyDetailContent");
    if (!detailContent) return;

    const totalLeads = data._count?.leads || 0;
    const totalCandidates = data._count?.candidates || 0;

    // Campaign status breakdown
    const cs = data.campaignStatusCounts || {};
    const activeCampaigns = (cs["scheduled"] || 0) + (cs["sent_initial"] || 0) + (cs["sent_followup_1"] || 0) + (cs["sent_followup_2"] || 0) + (cs["sent_followup_3"] || 0) + (cs["sent_followup_4"] || 0) + (cs["sent_followup_5"] || 0);
    const completedCampaigns = cs["completed"] || 0;
    const bouncedCampaigns = cs["bounced"] || 0;
    const repliedCampaigns = cs["replied"] || 0;
    const cancelledCampaigns = cs["cancelled"] || 0;
    const draftCampaigns = cs["draft"] || 0;

    // Research reason section
    const hasResearch = data.researchReason && data.researchReason.trim();
    const researchHtml = hasResearch
      ? `<div class="insight-research-value">"${data.researchReason}"</div>
         <button class="btn btn-outline btn-compact retry-research-btn" data-company-id="${data.id}" style="margin-top:8px;">
           🔄 Re-generate
         </button>`
      : `<div class="insight-research-missing">
           <span class="muted">No research reason generated yet</span>
           <button class="btn btn-accent btn-compact retry-research-btn" data-company-id="${data.id}" style="margin-top:8px;">
             🤖 Generate with AI
           </button>
         </div>`;

    // Applications section
    const appsHtml = data.applications && data.applications.length > 0
      ? data.applications.map(app => `
          <div class="insight-app-row">
            <div class="insight-app-main">
              <span class="insight-app-role">${app.role}</span>
              ${app.jobLink ? `<a href="${app.jobLink}" target="_blank" class="insight-app-link">View Job</a>` : ""}
            </div>
            <span class="insight-status-badge status-${(app.status || "not-applied").toLowerCase().replace(/\s+/g, "-")}">${app.status || "Not Applied"}</span>
          </div>
        `).join("")
      : `<div class="list-empty"><p class="muted">No applications found for this company.</p></div>`;

    detailContent.innerHTML = `
      <div class="company-detail-header">
        <div class="company-detail-title-row">
          <div>
            <h3 class="company-detail-name">${data.name}</h3>
            ${data.domain
              ? `<span class="company-detail-domain">🌐 ${data.domain}${data.domainConfidence > 0 ? ` <span class="insight-confidence-pill">${data.domainConfidence}% confidence</span>` : ""}</span>`
              : `<span class="company-detail-domain muted">No domain configured</span>`
            }
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            ${totalLeads === 0 ? `
              <button class="btn btn-outline delete-company-btn btn-danger btn-compact" data-company-id="${data.id}" data-company-name="${data.name}" type="button">
                🗑️ Delete Company
              </button>
            ` : ""}
            <span class="insight-date-created">Added ${new Date(data.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
      </div>

      <!-- Stat Grid -->
      <div class="insight-stat-grid">
        <div class="insight-stat-card">
          <span class="insight-stat-value">${totalLeads}</span>
          <span class="insight-stat-label">Total Leads</span>
        </div>
        <div class="insight-stat-card">
          <span class="insight-stat-value">${data.emailsSentCount || 0}</span>
          <span class="insight-stat-label">Emails Sent</span>
        </div>
        <div class="insight-stat-card">
          <span class="insight-stat-value">${activeCampaigns}</span>
          <span class="insight-stat-label">Active Campaigns</span>
        </div>
        <div class="insight-stat-card">
          <span class="insight-stat-value">${repliedCampaigns}</span>
          <span class="insight-stat-label">Replies</span>
        </div>
        <div class="insight-stat-card">
          <span class="insight-stat-value">${bouncedCampaigns}</span>
          <span class="insight-stat-label">Bounced</span>
        </div>
        <div class="insight-stat-card">
          <span class="insight-stat-value">${completedCampaigns}</span>
          <span class="insight-stat-label">Completed</span>
        </div>
      </div>

      <!-- Campaign Status Breakdown -->
      <div class="insight-section">
        <div class="insight-section-title">📈 Campaign Breakdown</div>
        <div class="insight-breakdown-pills">
          ${draftCampaigns > 0 ? `<span class="insight-pill pill-draft">${draftCampaigns} Draft</span>` : ""}
          ${activeCampaigns > 0 ? `<span class="insight-pill pill-active">${activeCampaigns} Active</span>` : ""}
          ${completedCampaigns > 0 ? `<span class="insight-pill pill-completed">${completedCampaigns} Completed</span>` : ""}
          ${bouncedCampaigns > 0 ? `<span class="insight-pill pill-bounced">${bouncedCampaigns} Bounced</span>` : ""}
          ${repliedCampaigns > 0 ? `<span class="insight-pill pill-replied">${repliedCampaigns} Replied</span>` : ""}
          ${cancelledCampaigns > 0 ? `<span class="insight-pill pill-cancelled">${cancelledCampaigns} Cancelled</span>` : ""}
          ${activeCampaigns + completedCampaigns + bouncedCampaigns + repliedCampaigns + cancelledCampaigns + draftCampaigns === 0 ? `<span class="muted">No campaigns started yet</span>` : ""}
        </div>
      </div>

      <!-- AI Research Reason -->
      <div class="insight-section">
        <div class="insight-section-title">🤖 AI Research Reason</div>
        <div class="insight-research-box">
          ${researchHtml}
        </div>
      </div>

      <!-- Applications -->
      <div class="insight-section">
        <div class="insight-section-title">💼 Applications</div>
        ${appsHtml}
      </div>
    `;

    // Wire retry-research button(s)
    detailContent.querySelectorAll(".retry-research-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cid = btn.getAttribute("data-company-id");
        btn.disabled = true;
        btn.textContent = "⏳ Generating...";
        try {
          const res = await fetch(`/admin/companies/${cid}/retry-research`, { method: "POST" });
          const result = await res.json();
          if (result.success) {
            showToast("Research reason updated! Reloading...");
            await loadAndRenderCompanyDetail(cid);
            // Also refresh state so the reason is up-to-date if user switches back
            fetchCompanies();
          } else {
            showToast("Failed to generate research reason.", "error");
            btn.disabled = false;
            btn.textContent = "🤖 Generate with AI";
          }
        } catch {
          showToast("Request failed.", "error");
          btn.disabled = false;
          btn.textContent = "🤖 Generate with AI";
        }
      });
    });

    // Wire delete-company button(s)
    detailContent.querySelectorAll(".delete-company-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const cid = btn.getAttribute("data-company-id");
        const cname = btn.getAttribute("data-company-name");
        deleteCompany(cid, cname);
      });
    });
  }

  async function updateGoogleStatus() {
    try {
      const res = await fetch("/admin/google/status");
      const { connected } = await res.json();
      if (connected) {
        if (googleStatusIndicator) {
          googleStatusIndicator.style.background = "#10b981";
          googleStatusIndicator.style.boxShadow = "0 0 8px #10b981";
        }
        if (googleStatusText) {
          googleStatusText.innerText = "Gmail Connected";
          googleStatusText.style.color = "#10b981";
        }
        if (connectGoogleButton) connectGoogleButton.style.display = "none";
        if (disconnectGoogleButton) disconnectGoogleButton.style.display = "inline-flex";
      } else {
        if (googleStatusIndicator) {
          googleStatusIndicator.style.background = "#ef4444";
          googleStatusIndicator.style.boxShadow = "0 0 8px #ef4444";
        }
        if (googleStatusText) {
          googleStatusText.innerText = "Google Sign-In Required";
          googleStatusText.style.color = "#ef4444";
        }
        if (connectGoogleButton) connectGoogleButton.style.display = "inline-flex";
        if (disconnectGoogleButton) disconnectGoogleButton.style.display = "none";
      }
    } catch (e) {
      console.error("Failed to fetch Google connection status:", e);
    }
  }

  async function checkGmailQuotaStatus() {
    try {
      const res = await fetch("/admin/gmail/quota-status");
      const { isHalted } = await res.json();
      
      const statusElement = document.getElementById("status");
      const warningBanner = document.getElementById("quotaWarningBanner");
      
      if (isHalted) {
        if (statusElement) {
          statusElement.innerText = "Gmail Quota breached, halting processing";
          statusElement.classList.add("quota-breached");
        }
        if (warningBanner) {
          warningBanner.style.display = "flex";
        }
      } else {
        if (statusElement) {
          statusElement.innerText = "System Operational";
          statusElement.classList.remove("quota-breached");
        }
        if (warningBanner) {
          warningBanner.style.display = "none";
        }
      }
    } catch (e) {
      console.error("Failed to fetch Gmail quota status:", e);
    }
  }

  // Core Sync Coordinator (Immediate reactivity)
  async function updateUI() {
    await Promise.all([
      fetchSummary(),
      fetchLeads(),
      fetchCompanies(),
      fetchEvents(),
      fetchQueue(),
      updateGoogleStatus(),
      checkGmailQuotaStatus(),
      fetchApplications()
    ]);

    renderMetrics();
    renderLeadsTable();
    renderTimelineLogs();
    renderCompaniesList();
    renderQueueTable();
    renderApplications();
  }

  // Resume Base64 Upload Listener
  if (formResume) {
    formResume.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) {
        state.resumeName = null;
        state.resumeBase64 = null;
        resumeUploadStatus.innerText = "Upload to attach to initial mail";
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showToast("Resume size must be under 5MB.", "error");
        formResume.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = function() {
        const resultStr = reader.result;
        // Strip data:application/pdf;base64, prefix
        const base64Index = resultStr.indexOf(";base64,") + 8;
        state.resumeBase64 = resultStr.substring(base64Index);
        state.resumeName = file.name;
        resumeUploadStatus.innerText = `File selected: "${file.name}" ready to attach`;
        showToast("Resume prepared successfully.");
      };
      reader.onerror = function() {
        showToast("Failed to parse PDF file.", "error");
      };
      reader.readAsDataURL(file);
    });
  }

  // Open Campaign Setup Drawer for a Lead
  async function openCampaignModal(leadId) {
    const lead = state.leads.find(l => l.id === leadId);
    if (!lead) return;

    state.selectedLeadId = leadId;
    state.bulkCompanyId = null;
    formLeadId.value = leadId;

    document.getElementById("modalTitle").innerText = "Configure Outreach Campaign";
    formRecipientEmail.parentElement.style.display = "flex";
    formRecipientEmail.setAttribute("required", "required");
    
    // Clear select recipient dropdown
    formRecipientEmail.innerHTML = "";

    // Populate candidate dropdown
    lead.candidates.forEach(candidate => {
      const opt = document.createElement("option");
      opt.value = candidate.id;
      opt.innerText = `${candidate.email} (score: ${candidate.verifierScore ?? 0} • ${candidate.algorithm?.patternTemplate || "Manual"})`;
      if (candidate.selected) {
        opt.selected = true;
      }
      formRecipientEmail.appendChild(opt);
    });

    // Preset pre-existing campaign fields if present
    const campaign = lead.campaignState;
    const formFollowupInterval = document.getElementById("formFollowupInterval");
    const formMaxFollowups = document.getElementById("formMaxFollowups");
    if (campaign) {
      formJobId.value = campaign.jobId || "";
      formJobLink.value = campaign.jobLink || "";
      if (formRoleName) formRoleName.value = campaign.roleName || "";
      formAutoFollowup.checked = campaign.status !== "completed" && campaign.status !== "bounced" && campaign.status !== "replied";
      if (formRespectTiming) formRespectTiming.checked = campaign.respectTiming || false;
      if (formFollowupInterval) formFollowupInterval.value = campaign.followupIntervalMinutes || "70";
      if (formMaxFollowups) formMaxFollowups.value = campaign.maxFollowups !== undefined ? campaign.maxFollowups : "3";
      if (campaign.scheduledFor) {
        const d = new Date(campaign.scheduledFor);
        const pad = (n) => n.toString().padStart(2, '0');
        const localString = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        formScheduleDate.value = localString;
      } else {
        formScheduleDate.value = "";
      }
      if (campaign.resumeName) {
        resumeUploadStatus.innerText = `Existing attached resume: "${campaign.resumeName}"`;
      } else {
        resumeUploadStatus.innerText = "Upload to attach to initial mail";
      }
    } else {
      // Clear inputs
      formJobId.value = "";
      formJobLink.value = "";
      if (formRoleName) formRoleName.value = "";
      formScheduleDate.value = "";
      formAutoFollowup.checked = true;
      if (formRespectTiming) formRespectTiming.checked = state.settings ? state.settings.respectTiming : false;
      if (formFollowupInterval) formFollowupInterval.value = state.settings ? state.settings.followupIntervalMinutes : "70";
      if (formMaxFollowups) formMaxFollowups.value = state.settings ? state.settings.maxFollowups : "3";
      resumeUploadStatus.innerText = "Upload to attach to initial mail";
    }

    state.resumeName = null;
    state.resumeBase64 = null;
    formResume.value = "";

    // Populate template dropdown
    await fetchTemplates();
    populateTemplateDropdowns(campaign ? campaign.templateId : undefined);

    // Show modal drawer
    campaignModal.classList.add("show");
  }

  // Open Bulk Campaign Setup Drawer for a Company
  async function openBulkCampaignModal(companyId, companyName) {
    state.bulkCompanyId = companyId;
    state.selectedLeadId = null;
    formLeadId.value = "";

    document.getElementById("modalTitle").innerText = `Start Campaign: ${companyName}`;
    formRecipientEmail.parentElement.style.display = "none";
    formRecipientEmail.removeAttribute("required");

    // Clear inputs
    formJobId.value = "";
    formJobLink.value = "";
    if (formRoleName) formRoleName.value = "";
    formScheduleDate.value = "";
    formAutoFollowup.checked = true;
    if (formRespectTiming) formRespectTiming.checked = state.settings ? state.settings.respectTiming : false;
    const formFollowupInterval = document.getElementById("formFollowupInterval");
    if (formFollowupInterval) formFollowupInterval.value = state.settings ? state.settings.followupIntervalMinutes : "70";
    const formMaxFollowups = document.getElementById("formMaxFollowups");
    if (formMaxFollowups) formMaxFollowups.value = state.settings ? state.settings.maxFollowups : "3";
    resumeUploadStatus.innerText = "Upload to attach to initial mail";

    state.resumeName = null;
    state.resumeBase64 = null;
    formResume.value = "";

    // Populate template dropdown
    await fetchTemplates();
    populateTemplateDropdowns();

    campaignModal.classList.add("show");

    // Prefill lookups asynchronously
    try {
      const res = await fetch(`/admin/applications/prefill?companyName=${encodeURIComponent(companyName)}`);
      const result = await res.json();
      if (result.success && result.match) {
        if (result.match.role) {
          if (formRoleName) formRoleName.value = result.match.role;
        }
        if (result.match.jobId) {
          formJobId.value = result.match.jobId;
        }
        if (result.match.jobLink) {
          formJobLink.value = result.match.jobLink;
        }
        showToast(`Prefilled job details from Applications Console.`);
      }
    } catch (e) {
      console.warn("Failed to retrieve prefill details:", e);
    }
  }

  // Open Bulk Campaign Setup Drawer for a Tag
  async function openBulkTagCampaignModal(tag) {
    state.bulkTag = tag;
    state.bulkCompanyId = null;
    state.selectedLeadId = null;
    formLeadId.value = "";

    document.getElementById("modalTitle").innerText = `Start Campaign for Tag: ${tag}`;
    formRecipientEmail.parentElement.style.display = "none";
    formRecipientEmail.removeAttribute("required");

    // Clear inputs
    formJobId.value = "";
    formJobLink.value = "";
    if (formRoleName) formRoleName.value = "";
    formScheduleDate.value = "";
    formAutoFollowup.checked = true;
    if (formRespectTiming) formRespectTiming.checked = state.settings ? state.settings.respectTiming : false;
    const formFollowupInterval = document.getElementById("formFollowupInterval");
    if (formFollowupInterval) formFollowupInterval.value = state.settings ? state.settings.followupIntervalMinutes : "70";
    const formMaxFollowups = document.getElementById("formMaxFollowups");
    if (formMaxFollowups) formMaxFollowups.value = state.settings ? state.settings.maxFollowups : "3";
    resumeUploadStatus.innerText = "Upload to attach to initial mail";

    state.resumeName = null;
    state.resumeBase64 = null;
    formResume.value = "";

    // Populate template dropdown
    await fetchTemplates();
    populateTemplateDropdowns();

    campaignModal.classList.add("show");
  }

  function closeModal() {
    campaignModal.classList.remove("show");
    state.selectedLeadId = null;
    state.bulkCompanyId = null;
    state.bulkTag = null;
  }

  // Attach modal buttons
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener("click", closeModal);

  // Submit Modal to start outreach sequence (coordinates single or bulk)
  if (campaignForm) {
    campaignForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const leadId = formLeadId.value;
      const candidateId = formRecipientEmail.value;
      const jobLink = formJobLink.value;
      const jobId = formJobId.value;
      const roleName = formRoleName ? formRoleName.value.trim() : "";
      const scheduledFor = formScheduleDate.value ? new Date(formScheduleDate.value).toISOString() : null;
      const autoFollowup = formAutoFollowup.checked;
      const respectTiming = formRespectTiming ? formRespectTiming.checked : false;
      const formFollowupInterval = document.getElementById("formFollowupInterval");
      const followupIntervalMinutes = formFollowupInterval ? parseInt(formFollowupInterval.value, 10) : 70;
      const formMaxFollowups = document.getElementById("formMaxFollowups");
      const maxFollowups = formMaxFollowups ? parseInt(formMaxFollowups.value, 10) : 3;

      const submitBtn = campaignForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Activating...";
      }

      const templateIdEl = document.getElementById("formTemplateId");
      const templateId = templateIdEl ? templateIdEl.value : "";

      const payload = {
        leadId: leadId || undefined,
        candidateId: candidateId || undefined,
        jobLink: jobLink || undefined,
        jobId: jobId || undefined,
        roleName: roleName || undefined,
        resumeName: state.resumeName || undefined,
        resumeBase64: state.resumeBase64 || undefined,
        scheduledFor: scheduledFor || undefined,
        autoFollowup,
        respectTiming,
        followupIntervalMinutes,
        maxFollowups,
        templateId: templateId || undefined
      };

      try {
        let endpoint = "/admin/campaigns";
        if (state.bulkCompanyId) {
          endpoint = `/admin/companies/${state.bulkCompanyId}/bulk-campaign`;
        } else if (state.bulkTag) {
          endpoint = "/admin/campaigns/bulk-by-tag";
          payload.tag = state.bulkTag;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (result.success) {
          if (state.bulkCompanyId) {
            showToast(`Bulk campaign scheduled successfully for ${result.count} leads!`);
          } else if (state.bulkTag) {
            showToast(`Bulk campaign scheduled successfully for ${result.count} leads with tag "${state.bulkTag}"!`);
          } else {
            showToast(`Campaign scheduled/activated successfully!`);
          }
          closeModal();
          updateUI();
        } else {
          showToast(result.message || "Failed to save campaign", "error");
        }
      } catch (err) {
        showToast("Server connection failed.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Activate Campaign";
        }
      }
    });
  }

  // Background Manual Queue Trigger Action Button
  if (runQueueButton) {
    runQueueButton.addEventListener("click", async () => {
      runQueueButton.disabled = true;
      runQueueButton.innerText = "Running...";
      try {
        const res = await fetch("/admin/campaigns/process-queue", { method: "POST" });
        const result = await res.json();
        
        if (result.success) {
          showToast(`Outreach queue processed! Emails sent: ${result.sentCount}`);
        } else {
          showToast("Failed to process queue.", "error");
        }
      } catch (e) {
        showToast("Error processing queue.", "error");
      } finally {
        runQueueButton.disabled = false;
        runQueueButton.innerText = "Process Queue Now";
        updateUI();
      }
    });
  }

  // Refresh/Sync Button Action
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      showToast("Syncing dashboard data...");
      updateUI();
    });
  }

  // Reset Gmail Quota Halt Action
  const resetQuotaHaltBtn = document.getElementById("resetQuotaHaltBtn");
  if (resetQuotaHaltBtn) {
    resetQuotaHaltBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/admin/gmail/reset-quota-halt", { method: "POST" });
        const result = await res.json();
        if (result.success) {
          showToast("Gmail quota halt reset successfully.");
          await checkGmailQuotaStatus();
        } else {
          showToast("Failed to reset Gmail quota halt.", "error");
        }
      } catch (e) {
        showToast("Error resetting Gmail quota halt.", "error");
      }
    });
  }

  // Collapsible Action Panels Toggle Logic
  const toggleManualLeadBtn = document.getElementById("toggleManualLeadBtn");
  const toggleCsvImportBtn = document.getElementById("toggleCsvImportBtn");
  const manualLeadPanel = document.getElementById("manualLeadPanel");
  const csvImportPanel = document.getElementById("csvImportPanel");

  if (toggleManualLeadBtn && manualLeadPanel) {
    toggleManualLeadBtn.addEventListener("click", () => {
      const isVisible = manualLeadPanel.classList.contains("show");
      if (isVisible) {
        manualLeadPanel.classList.remove("show");
        toggleManualLeadBtn.classList.remove("btn-accent");
      } else {
        manualLeadPanel.classList.add("show");
        toggleManualLeadBtn.classList.add("btn-accent");
        if (csvImportPanel) {
          csvImportPanel.classList.remove("show");
          if (toggleCsvImportBtn) toggleCsvImportBtn.classList.remove("btn-accent");
        }
      }
    });
  }

  if (toggleCsvImportBtn && csvImportPanel) {
    toggleCsvImportBtn.addEventListener("click", () => {
      const isVisible = csvImportPanel.classList.contains("show");
      if (isVisible) {
        csvImportPanel.classList.remove("show");
        toggleCsvImportBtn.classList.remove("btn-accent");
      } else {
        csvImportPanel.classList.add("show");
        toggleCsvImportBtn.classList.add("btn-accent");
        if (manualLeadPanel) {
          manualLeadPanel.classList.remove("show");
          if (toggleManualLeadBtn) toggleManualLeadBtn.classList.remove("btn-accent");
        }
      }
    });
  }

  // Gmail Bounce Manual Poller Action
  if (pollGmailButton) {
    pollGmailButton.addEventListener("click", async () => {
      pollGmailButton.disabled = true;
      pollGmailButton.innerText = "Polling Inbox...";
      try {
        const res = await fetch("/admin/gmail/poll", { method: "POST" });
        const result = await res.json();
        
        if (result.success) {
          showToast(result.message || "Inbox check finished successfully.");
        } else {
          showToast(result.message || "Unconfigured or error during polling", "error");
        }
      } catch (e) {
        showToast("Gmail polling failed to execute.", "error");
      } finally {
        pollGmailButton.disabled = false;
        pollGmailButton.innerText = "Poll Gmail Bounces";
        updateUI();
      }
    });
  }

  // Simulation Bouncer Action
  if (simulateBounceButton) {
    simulateBounceButton.addEventListener("click", async () => {
      const email = simulateEmailInput.value.trim();
      if (!email) {
        showToast("Please provide an email to simulate.", "error");
        return;
      }

      simulateBounceButton.disabled = true;
      try {
        const res = await fetch("/admin/gmail/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const result = await res.json();

        if (result.success) {
          showToast(`Bounce simulated for "${email}"!`);
          simulateEmailInput.value = "";
        } else {
          showToast(result.message || "Failed to simulate bounce.", "error");
        }
      } catch (e) {
        showToast("Simulation failed.", "error");
      } finally {
        simulateBounceButton.disabled = false;
        updateUI();
      }
    });
  }

  // ─── CSV IMPORT CONTROLLER ────────────────────────────────────────────────

  const csvFileInput        = document.getElementById("csvFileInput");
  const csvSelectFileBtn    = document.getElementById("csvSelectFileBtn");
  const csvFileName         = document.getElementById("csvFileName");
  const csvDropZone         = document.getElementById("csvDropZone");
  const csvPreviewSection   = document.getElementById("csvPreviewSection");
  const csvPreviewBody      = document.getElementById("csvPreviewBody");
  const csvCheckAll         = document.getElementById("csvCheckAll");
  const csvSelectAllBtn     = document.getElementById("csvSelectAllBtn");
  const csvDeselectDupsBtn  = document.getElementById("csvDeselectDupsBtn");
  const csvSelectNewOnlyBtn = document.getElementById("csvSelectNewOnlyBtn");
  const csvImportSelectedBtn= document.getElementById("csvImportSelectedBtn");
  const csvCancelBtn        = document.getElementById("csvCancelBtn");
  const csvStatTotal        = document.getElementById("csvStatTotal");
  const csvStatNew          = document.getElementById("csvStatNew");
  const csvStatDupCsv       = document.getElementById("csvStatDupCsv");
  const csvStatDupDb        = document.getElementById("csvStatDupDb");
  const csvSelectedCount    = document.getElementById("csvSelectedCount");

  let csvPreviewRows = []; // enriched rows from /leads/csv-preview

  // ── File picker wiring ────────────────────────────────────────────────────
  if (csvSelectFileBtn && csvFileInput) {
    csvSelectFileBtn.addEventListener("click", () => csvFileInput.click());
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  if (csvDropZone) {
    csvDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      csvDropZone.classList.add("drag-over");
    });
    csvDropZone.addEventListener("dragleave", () => csvDropZone.classList.remove("drag-over"));
    csvDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      csvDropZone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleCsvFile(file);
    });
  }

  // ── File input change ─────────────────────────────────────────────────────
  if (csvFileInput) {
    csvFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleCsvFile(file);
    });
  }

  // ── Core: read file, parse, preview-check, render ─────────────────────────
  async function handleCsvFile(file) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      showToast("Please select a .csv file.", "error");
      return;
    }

    if (csvFileName) csvFileName.textContent = file.name;

    const text = await file.text();
    const rawRows = parseCsvText(text);

    // parseCsvText returns { error } if headers are missing, or [] if no data rows
    if (rawRows && rawRows.error) {
      showToast(rawRows.error, "error");
      return;
    }

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      showToast("No valid rows found. Make sure the file has data rows below the header.", "error");
      return;
    }

    showToast(`Checking ${rawRows.length} rows against the database…`);

    try {
      const res = await fetch("/leads/csv-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawRows)
      });
      const result = await res.json();
      if (!result.success) {
        showToast(result.message || "Preview check failed.", "error");
        return;
      }
      csvPreviewRows = result.rows;
      renderCsvPreview();
    } catch (err) {
      showToast("Failed to connect to server for preview check.", "error");
    }
  }

  // ── CSV parser (robust, handles quotes, flexible headers) ──────────────────
  function parseCsvText(text) {
    const clean = text.replace(/^\uFEFF/, ""); // strip BOM
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ""));

    // Flexible header matching
    const find = (...names) => headers.findIndex(h => names.includes(h));
    const firstNameIdx = find("firstname", "first_name", "fname");
    const lastNameIdx  = find("lastname", "last_name", "lname");
    const emailIdx     = find("email", "emailaddress", "e-mail");
    const companyIdx   = find("company", "companyname", "organization", "org");

    if (firstNameIdx === -1 || emailIdx === -1 || companyIdx === -1) {
      return { error: "CSV must have columns: firstName, email, company. (lastName is optional)" };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCsvLine(lines[i]);
      const firstName = (vals[firstNameIdx] || "").trim();
      const email     = (vals[emailIdx] || "").trim();
      const company   = (vals[companyIdx] || "").trim();
      const lastName  = lastNameIdx !== -1 ? (vals[lastNameIdx] || "").trim() : "";

      if (!firstName || !email || !company) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue; // basic email check

      rows.push({ firstName, lastName: lastName || null, email, company });
    }
    return rows;
  }

  function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ── Escape HTML helper (prevents XSS in table rendering) ─────────────────
  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ── Render preview table ───────────────────────────────────────────────────
  function renderCsvPreview() {
    if (!csvPreviewSection || !csvPreviewBody) return;

    const rows = csvPreviewRows;
    const nNew     = rows.filter(r => r.status === "new").length;
    const nDupCsv  = rows.filter(r => r.status === "duplicate_csv").length;
    const nDupDb   = rows.filter(r => r.status === "duplicate_db").length;

    if (csvStatTotal)  csvStatTotal.textContent  = `${rows.length} total`;
    if (csvStatNew)    csvStatNew.textContent     = `${nNew} new`;
    if (csvStatDupCsv) csvStatDupCsv.textContent  = `${nDupCsv} dup in CSV`;
    if (csvStatDupDb)  csvStatDupDb.textContent   = `${nDupDb} in DB`;

    csvPreviewBody.innerHTML = rows.map((row, idx) => {
      const isNew = row.status === "new";
      const statusBadge = {
        new:           `<span class="csv-badge csv-badge-new">🟢 New</span>`,
        duplicate_csv: `<span class="csv-badge csv-badge-dup-csv" title="Same email as Row ${row.duplicateOf}">🟡 Dup in CSV</span>`,
        duplicate_db:  `<span class="csv-badge csv-badge-dup-db" title="Exists as: ${escHtml(row.duplicateOf || '')}">🔴 In DB</span>`
      }[row.status] || "";

      return `<tr class="csv-row ${row.status === "new" ? "" : "csv-row-flagged"}" data-idx="${idx}">
        <td><input type="checkbox" class="csv-row-check" data-idx="${idx}" ${isNew ? "checked" : ""} /></td>
        <td class="csv-row-num">${idx + 1}</td>
        <td>${escHtml(row.firstName)}</td>
        <td class="csv-cell-muted">${escHtml(row.lastName || "—")}</td>
        <td class="csv-cell-email">${escHtml(row.email)}</td>
        <td>${escHtml(row.company)}</td>
        <td>${statusBadge}${row.duplicateOf && row.status !== "new" ? `<span class="csv-dup-hint"> → ${escHtml(row.duplicateOf)}</span>` : ""}</td>
      </tr>`;
    }).join("");

    csvPreviewSection.style.display = "";
    updateCsvSelectionCount();

    // Bind row checkboxes
    csvPreviewBody.querySelectorAll(".csv-row-check").forEach(cb => {
      cb.addEventListener("change", updateCsvSelectionCount);
    });
  }

  function updateCsvSelectionCount() {
    const checked = csvPreviewBody ? csvPreviewBody.querySelectorAll(".csv-row-check:checked").length : 0;
    if (csvSelectedCount) csvSelectedCount.textContent = `${checked} row${checked !== 1 ? "s" : ""} selected`;
    if (csvImportSelectedBtn) csvImportSelectedBtn.disabled = checked === 0;
    if (csvCheckAll) csvCheckAll.indeterminate = checked > 0 && checked < csvPreviewRows.length;
    if (csvCheckAll) csvCheckAll.checked = checked === csvPreviewRows.length && csvPreviewRows.length > 0;
  }

  // ── Bulk selection helpers ─────────────────────────────────────────────────
  if (csvCheckAll) {
    csvCheckAll.addEventListener("change", () => {
      csvPreviewBody?.querySelectorAll(".csv-row-check").forEach(cb => {
        cb.checked = csvCheckAll.checked;
      });
      updateCsvSelectionCount();
    });
  }

  if (csvSelectAllBtn) {
    csvSelectAllBtn.addEventListener("click", () => {
      csvPreviewBody?.querySelectorAll(".csv-row-check").forEach(cb => cb.checked = true);
      updateCsvSelectionCount();
    });
  }

  if (csvDeselectDupsBtn) {
    csvDeselectDupsBtn.addEventListener("click", () => {
      csvPreviewBody?.querySelectorAll(".csv-row-check").forEach(cb => {
        const idx = parseInt(cb.getAttribute("data-idx"));
        const row = csvPreviewRows[idx];
        if (row && row.status !== "new") cb.checked = false;
      });
      updateCsvSelectionCount();
    });
  }

  if (csvSelectNewOnlyBtn) {
    csvSelectNewOnlyBtn.addEventListener("click", () => {
      csvPreviewBody?.querySelectorAll(".csv-row-check").forEach(cb => {
        const idx = parseInt(cb.getAttribute("data-idx"));
        const row = csvPreviewRows[idx];
        cb.checked = row?.status === "new";
      });
      updateCsvSelectionCount();
    });
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (csvCancelBtn) {
    csvCancelBtn.addEventListener("click", resetCsvPanel);
  }

  function resetCsvPanel() {
    csvPreviewRows = [];
    if (csvFileInput)      csvFileInput.value = "";
    if (csvFileName)       csvFileName.textContent = "No file selected";
    if (csvPreviewSection) csvPreviewSection.style.display = "none";
    if (csvPreviewBody)    csvPreviewBody.innerHTML = "";
    if (csvImportSelectedBtn) csvImportSelectedBtn.disabled = true;
    if (csvImportPanel)    csvImportPanel.classList.remove("show");
    if (toggleCsvImportBtn) toggleCsvImportBtn.classList.remove("btn-accent");
  }

  // ── Import selected rows ───────────────────────────────────────────────────
  if (csvImportSelectedBtn) {
    csvImportSelectedBtn.addEventListener("click", async () => {
      const checked = Array.from(csvPreviewBody?.querySelectorAll(".csv-row-check:checked") || []);
      const selectedRows = checked.map(cb => {
        const idx = parseInt(cb.getAttribute("data-idx"));
        const row = csvPreviewRows[idx];
        return {
          firstName:  row.firstName,
          lastName:   row.lastName || null,
          email:      row.email,
          company:    row.company,
          preVerified: false
        };
      });

      if (selectedRows.length === 0) return;

      csvImportSelectedBtn.disabled = true;
      csvImportSelectedBtn.textContent = `Importing ${selectedRows.length} leads…`;

      try {
        const res = await fetch("/leads/bulk-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selectedRows)
        });
        const result = await res.json();
        if (result.success) {
          showToast(`✅ Successfully imported ${result.count} lead${result.count !== 1 ? "s" : ""}!`);
          resetCsvPanel();
          updateUI();
        } else {
          showToast(result.message || "Import failed.", "error");
        }
      } catch (err) {
        showToast("Server connection failed.", "error");
      } finally {
        csvImportSelectedBtn.disabled = false;
        csvImportSelectedBtn.textContent = "Import Selected";
      }
    });
  }


  // Manual Lead Form Submission
  const manualLeadForm = document.getElementById("manualLeadForm");
  if (manualLeadForm) {
    manualLeadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const manualFirstName = document.getElementById("manualFirstName");
      const manualLastName = document.getElementById("manualLastName");
      const manualEmail = document.getElementById("manualEmail");
      const manualCompany = document.getElementById("manualCompany");
      const manualEmailVerified = document.getElementById("manualEmailVerified");
      
      const submitBtn = manualLeadForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Adding...";
      }
      
      const payload = [{
        firstName: manualFirstName.value.trim(),
        lastName: manualLastName.value.trim() || undefined,
        email: manualEmail.value.trim(),
        company: manualCompany.value.trim(),
        preVerified: manualEmailVerified ? manualEmailVerified.checked : false
      }];
      
      try {
        const res = await fetch("/leads/bulk-csv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success && result.count > 0) {
          showToast(`Successfully added lead manually!`);
          manualLeadForm.reset();
          updateUI();
        } else {
          showToast(result.message || "Failed to add lead", "error");
        }
      } catch (err) {
        showToast("Request failed", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Add Lead";
        }
      }
    });
  }

  // Applications Console Form Submission (handles both add and edit)
  if (addApplicationForm) {
    addApplicationForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const companyName = appCompanyName.value.trim();
      const role = appRole.value.trim();
      const jobId = appJobId.value.trim();
      const jobLink = appJobLink.value.trim();

      const isEdit = !!state.editingApplicationId;
      const endpoint = isEdit ? `/admin/applications/${state.editingApplicationId}` : "/admin/applications";
      const method = isEdit ? "PATCH" : "POST";

      const submitBtn = appFormSubmitBtn || addApplicationForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = isEdit ? "Saving..." : "Adding...";
      }

      try {
        const res = await fetch(endpoint, {
          method,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ companyName, role, jobLink, jobId })
        });
        const result = await res.json();
        if (result.success) {
          showToast(isEdit ? "Application updated successfully!" : "Application added successfully!");
          resetApplicationEditor();
          await fetchApplications();
          renderApplications();
        } else {
          showToast(result.message || (isEdit ? "Failed to update application" : "Failed to add application"), "error");
        }
      } catch (err) {
        showToast(isEdit ? "Error updating application." : "Error adding application.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = isEdit ? "Save Application" : "Add Application";
        }
      }
    });
  }

  // Cancel edit button click
  if (cancelAppEditBtn) {
    cancelAppEditBtn.addEventListener("click", resetApplicationEditor);
  }

  // Search & Filter listeners
  if (leadsSearchInput) {
    leadsSearchInput.addEventListener("input", () => {
      leadsCurrentPage = 1;
      renderLeadsTable();
    });
  }

  if (leadsPrevPageBtn) {
    leadsPrevPageBtn.addEventListener("click", () => {
      if (leadsCurrentPage > 1) {
        leadsCurrentPage--;
        renderLeadsTable();
      }
    });
  }

  if (leadsNextPageBtn) {
    leadsNextPageBtn.addEventListener("click", () => {
      const filteredLeads = getFilteredLeads();
      const totalPages = Math.ceil(filteredLeads.length / leadsPageSize) || 1;
      if (leadsCurrentPage < totalPages) {
        leadsCurrentPage++;
        renderLeadsTable();
      }
    });
  }

  // Outbox Queue search & filter listeners
  if (queueSearchInput) {
    queueSearchInput.addEventListener("input", () => {
      state.queueSearchQuery = queueSearchInput.value;
      renderQueueTable();
    });
  }

  if (queueStatusFilter) {
    queueStatusFilter.addEventListener("change", () => {
      state.queueStatusFilter = queueStatusFilter.value;
      renderQueueTable();
    });
  }

  if (companyQueueSearchInput) {
    companyQueueSearchInput.addEventListener("input", () => {
      state.companyQueueSearchQuery = companyQueueSearchInput.value;
      renderQueueTable();
    });
  }

  if (companyQueueStatusFilter) {
    companyQueueStatusFilter.addEventListener("change", () => {
      state.companyQueueStatusFilter = companyQueueStatusFilter.value;
      renderQueueTable();
    });
  }

  // Edit Lead Modal Listeners
  if (closeEditLeadModalBtn) {
    closeEditLeadModalBtn.addEventListener("click", () => {
      if (editLeadModal) editLeadModal.classList.remove("show");
    });
  }

  if (cancelEditLeadBtn) {
    cancelEditLeadBtn.addEventListener("click", () => {
      if (editLeadModal) editLeadModal.classList.remove("show");
    });
  }

  if (editLeadForm) {
    editLeadForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const leadId = editLeadId.value;
      const fullName = editLeadFullName.value.trim();
      const companyName = editLeadCompany.value.trim();
      const email = editLeadEmail.value.trim();
      const tags = editLeadTags.value.trim();

      const submitBtn = editLeadForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Saving...";
      }

      try {
        const res = await fetch(`/admin/leads/${leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, companyName, tags })
        });
        const result = await res.json();
        if (result.success) {
          showToast("Lead updated successfully!");
          if (editLeadModal) editLeadModal.classList.remove("show");
          updateUI();
        } else {
          showToast(result.message || "Failed to update lead.", "error");
        }
      } catch (err) {
        showToast("Error updating lead.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Save Changes";
        }
      }
    });
  }

  // Google Sign-In Listeners
  if (connectGoogleButton) {
    connectGoogleButton.addEventListener("click", () => {
      window.location.href = "/auth/google";
    });
  }

  if (disconnectGoogleButton) {
    disconnectGoogleButton.addEventListener("click", async () => {
      const confirmed = await showConfirm("Are you sure you want to disconnect your Google account? This will stop outreach email automation.");
      if (!confirmed) {
        return;
      }
      try {
        const res = await fetch("/admin/google/disconnect", { method: "POST" });
        const result = await res.json();
        if (result.success) {
          showToast("Successfully disconnected Google account.");
          updateGoogleStatus();
        } else {
          showToast("Failed to disconnect Google account.", "error");
        }
      } catch (err) {
        showToast("Request failed", "error");
      }
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("google_connected") === "true") {
    showToast("Successfully authenticated and connected Gmail account!");
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
  }

  // Close any open action dropdowns on clicking outside
  document.addEventListener("click", () => {
    document.querySelectorAll(".actions-dropdown-container").forEach(c => {
      c.classList.remove("open");
    });
  });

  // ─── TEMPLATES CONTROLLER ─────────────────────────────────────────────────

  const templateNameEl = document.getElementById("templateName");
  const templateSubjectEl = document.getElementById("templateSubject");
  const templateBodyEl = document.getElementById("templateBody");
  const templateIsDefaultEl = document.getElementById("templateIsDefault");
  const templateSaveBtnEl = document.getElementById("templateSaveBtn");
  const templateCancelEditBtnEl = document.getElementById("templateCancelEditBtn");
  const templateEditorTitleEl = document.getElementById("templateEditorTitle");
  const templatesListEl = document.getElementById("templatesList");
  const templateCountBadgeEl = document.getElementById("templateCountBadge");
  const formTemplateIdEl = document.getElementById("formTemplateId");

  // Premium UI Elements
  const btnTabWrite = document.getElementById("btnTabWrite");
  const btnTabPreview = document.getElementById("btnTabPreview");
  const templateWriteContainer = document.getElementById("templateWriteContainer");
  const templatePreviewContainer = document.getElementById("templatePreviewContainer");
  const previewSubjectEl = document.getElementById("previewSubject");
  const previewBodyEl = document.getElementById("previewBody");

  // Mock data for live email preview
  const mockData = {
    name: "John Doe",
    first_name: "John",
    company: "Rubrik",
    role: "Senior Distributed Systems Engineer",
    job_id: "R-10023",
    job_link: "https://rubrik.com/careers/r-10023",
    resume: "resume.pdf",
    reason: "your recent engineering pivot towards zero-trust data security architectures, where building reliable state machine replication (SMR) and distributed consensus layers is paramount"
  };

  // Helper to format text with glowing neon variables
  function formatPreviewText(text, isBody = false) {
    if (!text) return "";
    let escaped = escHtml(text);

    // Strip optional block square brackets (keeping the contents inside)
    escaped = escaped.replace(/\[([^\]]*?)\]/g, (match, blockContent) => {
      return blockContent;
    });

    // Replace valid placeholders with glowing pills
    Object.keys(mockData).forEach(key => {
      const placeholder = `{${key}}`;
      const val = mockData[key];
      const regex = new RegExp(placeholder, "g");
      const tagHtml = `<span class="preview-variable-tag variable-${key}">${escHtml(val)}</span>`;
      escaped = escaped.replace(regex, tagHtml);
    });

    // Flag any unknown placeholders as warning pills
    escaped = escaped.replace(/\{([a-zA-Z0-9_]+)\}/g, (match) => {
      return `<span class="preview-variable-tag variable-unknown" title="Unknown placeholder">${escHtml(match)}</span>`;
    });

    if (isBody) {
      escaped = escaped.replace(/\n/g, "<br>");
    }
    return escaped;
  }

  // Calculate and update real-time statistics
  function updateEditorStats() {
    const text = templateBodyEl?.value || "";
    const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const chars = text ? text.length : 0;
    const placeholders = (text.match(/\{[a-zA-Z0-9_]+\}/g) || []).length;
    const min = Math.ceil(words / 225);
    const readTimeStr = words === 0 ? "0 min read" : (min <= 1 ? "< 1 min read" : `${min} min read`);

    const wordCountEl = document.getElementById("wordCount");
    const charCountEl = document.getElementById("charCount");
    const variableCountEl = document.getElementById("variableCount");
    const readTimeEl = document.getElementById("readTime");

    if (wordCountEl) wordCountEl.textContent = `${words} word${words === 1 ? "" : "s"}`;
    if (charCountEl) charCountEl.textContent = `${chars} char${chars === 1 ? "" : "s"}`;
    if (variableCountEl) variableCountEl.textContent = `${placeholders} placeholder${placeholders === 1 ? "" : "s"}`;
    if (readTimeEl) readTimeEl.textContent = readTimeStr;
  }

  // Update HTML mockup content
  function updateTemplatePreview() {
    const subjectText = templateSubjectEl?.value || "";
    const bodyText = templateBodyEl?.value || "";

    if (previewSubjectEl) {
      previewSubjectEl.innerHTML = formatPreviewText(subjectText, false);
    }
    if (previewBodyEl) {
      previewBodyEl.innerHTML = formatPreviewText(bodyText, true);
    }
  }

  // Setup tab toggling event listeners
  if (btnTabWrite && btnTabPreview && templateWriteContainer && templatePreviewContainer) {
    btnTabWrite.addEventListener("click", () => {
      btnTabWrite.classList.add("active");
      btnTabPreview.classList.remove("active");
      templateWriteContainer.style.display = "block";
      templatePreviewContainer.style.display = "none";
    });

    btnTabPreview.addEventListener("click", () => {
      btnTabPreview.classList.add("active");
      btnTabWrite.classList.remove("active");
      templateWriteContainer.style.display = "none";
      templatePreviewContainer.style.display = "block";
      updateTemplatePreview();
    });
  }

  // Setup Copy AI Prompt button handler
  const btnCopyAiPrompt = document.getElementById("btnCopyAiPrompt");
  if (btnCopyAiPrompt) {
    btnCopyAiPrompt.addEventListener("click", () => {
      const promptText = `Write a personalized email outreach template for candidate outreach.
You must use our template placeholders exactly as defined below to personalize the emails.

Available Placeholders:
- {name}: Full name of the candidate
- {first_name}: First name of the candidate
- {company}: Company name the candidate works at (or recently worked at)
- {role}: The job title / role we are targeting
- {job_id}: The job ID for reference
- {job_link}: The application/job posting URL
- {resume}: The link to my resume
- {reason}: A custom statement continuation describing the reason for targeting the company (e.g., "your recent engineering pivot towards zero-trust data security architectures").

Optional Sections Formatting:
If a placeholder is optional (like {job_id} or {job_link}) and might be empty, wrap the placeholder and any surrounding punctuation/text in square brackets: [ ... ]. 
If the optional placeholder resolves to empty during execution, the entire block inside the brackets will be cleanly removed. If it is present, the brackets will be stripped and the content preserved.
For example:
- "DevOps Engineer Application – {name}[ | {job_id}]" (the pipe and ID are only shown if job_id is provided)
- "role at {company}[ ({job_link})]" (the parentheses and URL are only shown if job_link is provided)

Please provide:
1. A catchy Subject Line using placeholders and optional blocks where appropriate.
2. The Email Body using placeholders and optional blocks naturally to make the email sound highly tailored, professional, and concise. Note that the {reason} placeholder acts as a continuous statement (e.g. "I'm specifically interested in {company} because of {reason}.").
3. End the email body with the following call-to-action and signature block exactly as shown below (do not change or modify this block):
Happy to connect for a quick 15-minute call if there's a fit

Regards,
Vidhi Chadha
8178113237`;

      navigator.clipboard.writeText(promptText)
        .then(() => {
          showToast("AI Prompt copied to clipboard!");
        })
        .catch(() => {
          showToast("Failed to copy prompt.", "error");
        });
    });
  }

  // Track last focused template field for chip insertion
  const templateFocusFields = [templateSubjectEl, templateBodyEl];
  templateFocusFields.forEach(el => {
    if (el) el.addEventListener("focus", () => {
      state.lastFocusedTemplateField = el;
    });
  });

  if (templateBodyEl) {
    templateBodyEl.addEventListener("input", updateEditorStats);
  }

  // Initial stats calculation
  updateEditorStats();

  // Placeholder chip click → insert at cursor
  document.querySelectorAll(".chip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const placeholder = btn.getAttribute("data-placeholder");
      const target = state.lastFocusedTemplateField;
      if (!target || !placeholder) {
        showToast("Click into Subject or Body first, then click a chip.", "error");
        return;
      }
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.substring(0, start) + placeholder + target.value.substring(end);
      target.focus();
      target.selectionStart = start + placeholder.length;
      target.selectionEnd = start + placeholder.length;
      updateEditorStats();
    });
  });

  async function fetchTemplates() {
    try {
      const res = await fetch("/admin/templates");
      state.templates = await res.json();
    } catch (e) {
      console.error("Failed to fetch templates:", e);
    }
  }

  function renderTemplatesList() {
    if (!templatesListEl) return;
    const templates = state.templates;

    if (templateCountBadgeEl) templateCountBadgeEl.textContent = templates.length;

    if (templates.length === 0) {
      templatesListEl.innerHTML = `
        <div class="templates-empty-state">
          <span class="empty-icon">📭</span>
          <p>No templates yet. Create your first one!</p>
        </div>`;
      return;
    }

    templatesListEl.innerHTML = templates.map(t => `
      <div class="template-item-card ${t.isDefault ? 'template-item-default' : ''}" data-id="${t.id}">
        <div class="template-item-header">
          <div class="template-item-name">
            ${t.isDefault ? '<span class="default-badge">⭐ Default</span>' : ''}
            <span class="tpl-name">${escHtml(t.name)}</span>
          </div>
          <div class="template-item-actions">
            ${!t.isDefault ? `<button class="chip-action-btn tpl-default-btn" data-id="${t.id}" title="Set as Default">⭐</button>` : ''}
            <button class="chip-action-btn tpl-edit-btn" data-id="${t.id}" title="Edit">✏️</button>
            <button class="chip-action-btn tpl-delete-btn" data-id="${t.id}" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="template-item-subject">📧 ${escHtml(t.subject)}</div>
        <div class="template-item-preview">${escHtml(t.body.substring(0, 120))}${t.body.length > 120 ? '…' : ''}</div>
      </div>
    `).join("");

    // Bind item actions
    templatesListEl.querySelectorAll(".tpl-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => startEditTemplate(btn.getAttribute("data-id")));
    });
    templatesListEl.querySelectorAll(".tpl-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteTemplate(btn.getAttribute("data-id")));
    });
    templatesListEl.querySelectorAll(".tpl-default-btn").forEach(btn => {
      btn.addEventListener("click", () => setDefaultTemplate(btn.getAttribute("data-id")));
    });
  }

  function populateTemplateDropdowns(targetTemplateId) {
    if (!formTemplateIdEl) return;
    formTemplateIdEl.innerHTML = `
      <option value="">— Select Template —</option>
      <option value="system">— Use System Template (Hardcoded) —</option>
    `;
    
    // Determine which template should be selected
    let selectedId = "";
    
    if (targetTemplateId !== undefined) {
      selectedId = targetTemplateId === null ? "system" : (targetTemplateId || "");
    } else {
      // Default to marked default template in state
      const defaultTpl = state.templates.find(t => t.isDefault);
      if (defaultTpl) {
        selectedId = defaultTpl.id;
      } else {
        selectedId = "system";
      }
    }

    state.templates.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name}${t.isDefault ? " ⭐" : ""}`;
      if (t.id === selectedId) opt.selected = true;
      formTemplateIdEl.appendChild(opt);
    });

    formTemplateIdEl.value = selectedId;
  }

  function resetTemplateEditor() {
    if (templateNameEl) templateNameEl.value = "";
    if (templateSubjectEl) templateSubjectEl.value = "";
    if (templateBodyEl) templateBodyEl.value = "";
    if (templateIsDefaultEl) templateIsDefaultEl.checked = false;
    if (templateEditorTitleEl) templateEditorTitleEl.textContent = "New Template";
    if (templateCancelEditBtnEl) templateCancelEditBtnEl.style.display = "none";
    state.editingTemplateId = null;
    state.lastFocusedTemplateField = null;

    // Reset tabs to Write mode
    btnTabWrite?.click();
    updateEditorStats();
  }

  function startEditTemplate(id) {
    const tpl = state.templates.find(t => t.id === id);
    if (!tpl) return;
    state.editingTemplateId = id;
    if (templateNameEl) templateNameEl.value = tpl.name;
    if (templateSubjectEl) templateSubjectEl.value = tpl.subject;
    if (templateBodyEl) templateBodyEl.value = tpl.body;
    if (templateIsDefaultEl) templateIsDefaultEl.checked = tpl.isDefault;
    if (templateEditorTitleEl) templateEditorTitleEl.textContent = `Editing: ${tpl.name}`;
    if (templateCancelEditBtnEl) templateCancelEditBtnEl.style.display = "";
    templateNameEl?.focus();

    // Reset tabs to Write mode
    btnTabWrite?.click();
    updateEditorStats();

    // Scroll to top of editor
    document.querySelector(".template-editor-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveTemplate() {
    const name = templateNameEl?.value.trim();
    const subject = templateSubjectEl?.value.trim();
    const body = templateBodyEl?.value.trim();
    const isDefault = templateIsDefaultEl?.checked ?? false;

    if (!name) { showToast("Template name is required.", "error"); return; }
    if (!subject) { showToast("Subject line is required.", "error"); return; }
    if (!body) { showToast("Email body is required.", "error"); return; }

    const isEdit = !!state.editingTemplateId;
    const url = isEdit ? `/admin/templates/${state.editingTemplateId}` : "/admin/templates";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, body, isDefault })
      });
      const result = await res.json();
      if (result.success) {
        showToast(isEdit ? "Template updated!" : "Template saved!");
        resetTemplateEditor();
        await fetchTemplates();
        renderTemplatesList();
        populateTemplateDropdowns();
      } else {
        showToast(result.message || "Failed to save template", "error");
      }
    } catch {
      showToast("Server error saving template.", "error");
    }
  }

  async function deleteTemplate(id) {
    const tpl = state.templates.find(t => t.id === id);
    const confirmed = await showConfirm(`Delete template "${tpl?.name || id}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/admin/templates/${id}`, { method: "DELETE" });
      const result = await res.json();
      if (result.success) {
        showToast("Template deleted.");
        if (state.editingTemplateId === id) resetTemplateEditor();
        await fetchTemplates();
        renderTemplatesList();
        populateTemplateDropdowns();
      } else {
        showToast(result.message || "Failed to delete template", "error");
      }
    } catch {
      showToast("Server error deleting template.", "error");
    }
  }

  async function setDefaultTemplate(id) {
    try {
      const res = await fetch(`/admin/templates/${id}/default`, { method: "PATCH" });
      const result = await res.json();
      if (result.success) {
        showToast("Default template updated!");
        await fetchTemplates();
        renderTemplatesList();
        populateTemplateDropdowns();
      } else {
        showToast(result.message || "Failed to set default", "error");
      }
    } catch {
      showToast("Server error.", "error");
    }
  }

  // Wire up editor save/cancel buttons
  if (templateSaveBtnEl) templateSaveBtnEl.addEventListener("click", saveTemplate);
  if (templateCancelEditBtnEl) templateCancelEditBtnEl.addEventListener("click", resetTemplateEditor);

  // Load templates when tab is opened
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.getAttribute("data-tab") === "tab-templates") {
        await fetchTemplates();
        renderTemplatesList();
      }
    });
  });

  // ─── BACKUP & RECOVERY CONTROLLER ─────────────────────────────────────────

  const backupsListBodyEl = document.getElementById("backupsListBody");
  const backupCountBadgeEl = document.getElementById("backupCountBadge");
  const btnCreateBackupEl = document.getElementById("btnCreateBackup");
  const restoreModalEl = document.getElementById("restoreModal");
  const restoreFormEl = document.getElementById("restoreForm");
  const restoreSnapshotFileEl = document.getElementById("restoreSnapshotFile");
  const restoreSnapshotNameDisplayEl = document.getElementById("restoreSnapshotNameDisplay");
  const closeRestoreModalBtnEl = document.getElementById("closeRestoreModalBtn");
  const cancelRestoreModalBtnEl = document.getElementById("cancelRestoreModalBtn");

  async function fetchBackups() {
    try {
      const res = await fetch("/admin/backups");
      const backups = await res.json();
      renderBackupsList(backups);
    } catch (e) {
      console.error("Failed to fetch backups:", e);
      showToast("Failed to fetch backups list.", "error");
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function renderBackupsList(backups) {
    if (!backupsListBodyEl) return;
    if (backupCountBadgeEl) backupCountBadgeEl.textContent = backups.length;

    if (backups.length === 0) {
      backupsListBodyEl.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-4" style="color: var(--color-text-muted); text-align: center; padding: 24px;">
            🗄️ No snapshots found in the backups/ directory.
          </td>
        </tr>`;
      return;
    }

    backupsListBodyEl.innerHTML = backups.map(b => {
      const dateStr = new Date(b.createdAt).toLocaleString();
      return `
        <tr>
          <td style="font-family: monospace; font-size: 13px; color: var(--color-text-bright);">${escHtml(b.filename)}</td>
          <td>${dateStr}</td>
          <td>${formatBytes(b.size)}</td>
          <td class="actions-cell">
            <button class="btn btn-outline btn-compact btn-restore" data-file="${escHtml(b.filename)}" type="button" style="margin-right: 8px;">🔄 Restore</button>
            <button class="btn btn-outline btn-compact btn-delete-backup" data-file="${escHtml(b.filename)}" type="button" style="border-color: rgba(239, 68, 68, 0.25); color: #f87171;">🗑️ Delete</button>
          </td>
        </tr>`;
    }).join("");

    // Bind Restore buttons
    backupsListBodyEl.querySelectorAll(".btn-restore").forEach(btn => {
      btn.addEventListener("click", () => {
        const filename = btn.getAttribute("data-file");
        showRestoreModal(filename);
      });
    });

    // Bind Delete buttons
    backupsListBodyEl.querySelectorAll(".btn-delete-backup").forEach(btn => {
      btn.addEventListener("click", async () => {
        const filename = btn.getAttribute("data-file");
        const confirmed = await showConfirm(`Are you sure you want to permanently delete the snapshot file "${filename}"?`);
        if (!confirmed) return;

        try {
          const res = await fetch(`/admin/backup/${encodeURIComponent(filename)}`, {
            method: "DELETE"
          });
          const result = await res.json();
          if (result.success) {
            showToast("Backup snapshot deleted.");
            await fetchBackups();
          } else {
            showToast(result.message || "Failed to delete snapshot", "error");
          }
        } catch (e) {
          showToast("Server error deleting snapshot.", "error");
        }
      });
    });
  }

  function showRestoreModal(filename) {
    if (!restoreModalEl) return;
    if (restoreSnapshotFileEl) restoreSnapshotFileEl.value = filename;
    if (restoreSnapshotNameDisplayEl) restoreSnapshotNameDisplayEl.textContent = filename;
    restoreModalEl.classList.add("show");
  }

  function closeRestoreModal() {
    if (restoreModalEl) restoreModalEl.classList.remove("show");
  }

  if (closeRestoreModalBtnEl) closeRestoreModalBtnEl.addEventListener("click", closeRestoreModal);
  if (cancelRestoreModalBtnEl) cancelRestoreModalBtnEl.addEventListener("click", closeRestoreModal);

  if (btnCreateBackupEl) {
    btnCreateBackupEl.addEventListener("click", async () => {
      btnCreateBackupEl.disabled = true;
      btnCreateBackupEl.textContent = "Creating Snapshot...";
      try {
        const res = await fetch("/admin/backup", { method: "POST" });
        const result = await res.json();
        if (result.success) {
          showToast(`Snapshot created: ${result.filename}`);
          await fetchBackups();
        } else {
          showToast(result.message || "Failed to create snapshot", "error");
        }
      } catch (e) {
        showToast("Server error creating snapshot.", "error");
      } finally {
        btnCreateBackupEl.disabled = false;
        btnCreateBackupEl.textContent = "Create Backup Snapshot";
      }
    });
  }

  if (restoreFormEl) {
    restoreFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const filename = restoreSnapshotFileEl?.value;
      const mode = restoreFormEl.elements["restoreMode"].value;
      const confirmButton = document.getElementById("btnConfirmRestore");

      if (!filename) return;

      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = "Restoring Database...";
      }

      try {
        const res = await fetch("/admin/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, mode })
        });
        const result = await res.json();
        if (result.success) {
          showToast(`Database successfully restored in ${mode} mode!`);
          closeRestoreModal();
          
          // Trigger a full UI and state reload
          updateUI();
          if (typeof fetchTemplates === "function") {
            await fetchTemplates();
            renderTemplatesList();
            populateTemplateDropdowns();
          }
        } else {
          showToast(result.message || "Failed to restore snapshot", "error");
        }
      } catch (e) {
        showToast("Server error restoring snapshot.", "error");
      } finally {
        if (confirmButton) {
          confirmButton.disabled = false;
          confirmButton.textContent = "Confirm Restore";
        }
      }
    });
  }

  // Hook backup tab button
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.getAttribute("data-tab") === "tab-backup") {
        await fetchBackups();
      }
    });
  });

  // ─── SYSTEM SETTINGS CONTROLLER ─────────────────────────────────────────

  async function fetchSettings() {
    try {
      const res = await fetch("/admin/settings");
      const settings = await res.json();
      state.settings = settings;

      const settingsRespectTiming = document.getElementById("settingsRespectTiming");
      const settingsTimingStartHour = document.getElementById("settingsTimingStartHour");
      const settingsTimingEndHour = document.getElementById("settingsTimingEndHour");
      const settingsFollowupInterval = document.getElementById("settingsFollowupInterval");
      const settingsMaxFollowups = document.getElementById("settingsMaxFollowups");
      const settingsDefaultResumeLink = document.getElementById("settingsDefaultResumeLink");
      const settingsVerifierProvider = document.getElementById("settingsVerifierProvider");
      const settingsEnableAiPattern = document.getElementById("settingsEnableAiPattern");
      const settingsGmailMonitor = document.getElementById("settingsGmailMonitor");
      const settingsJobSearchEnabled = document.getElementById("settingsJobSearchEnabled");
      const settingsJobSearchQuery = document.getElementById("settingsJobSearchQuery");
      const settingsJobSearchLocations = document.getElementById("settingsJobSearchLocations");
      const settingsJobSearchWorkplaceTypes = document.getElementById("settingsJobSearchWorkplaceTypes");
      const settingsJobSearchKeywords = document.getElementById("settingsJobSearchKeywords");
      const settingsJobSearchInterval = document.getElementById("settingsJobSearchInterval");
      const settingsJobSearchTimeRange = document.getElementById("settingsJobSearchTimeRange");

      if (settingsRespectTiming) {
        settingsRespectTiming.checked = settings.respectTiming || false;
        const settingsTimingHoursGroup = document.getElementById("settingsTimingHoursGroup");
        if (settingsTimingHoursGroup) {
          settingsTimingHoursGroup.style.display = settingsRespectTiming.checked ? "block" : "none";
        }
        if (!settingsRespectTiming.dataset.listenerWired) {
          settingsRespectTiming.addEventListener("change", () => {
            if (settingsTimingHoursGroup) {
              settingsTimingHoursGroup.style.display = settingsRespectTiming.checked ? "block" : "none";
            }
          });
          settingsRespectTiming.dataset.listenerWired = "true";
        }
      }
      const settingsSkipWeekends = document.getElementById("settingsSkipWeekends");
      if (settingsSkipWeekends) settingsSkipWeekends.checked = settings.skipWeekends !== undefined ? settings.skipWeekends : true;
      if (settingsTimingStartHour) settingsTimingStartHour.value = settings.timingStartHour !== undefined ? settings.timingStartHour : 9;
      if (settingsTimingEndHour) settingsTimingEndHour.value = settings.timingEndHour !== undefined ? settings.timingEndHour : 17;
      if (settingsFollowupInterval) settingsFollowupInterval.value = settings.followupIntervalMinutes || 70;
      if (settingsMaxFollowups) settingsMaxFollowups.value = settings.maxFollowups !== undefined ? settings.maxFollowups : 3;
      if (settingsDefaultResumeLink) settingsDefaultResumeLink.value = settings.defaultResumeLink || "";
      if (settingsVerifierProvider) settingsVerifierProvider.value = settings.emailVerifierProvider || "local";
      if (settingsEnableAiPattern) settingsEnableAiPattern.checked = settings.enableAiPatternDiscovery || false;
      if (settingsGmailMonitor) settingsGmailMonitor.checked = settings.gmailMonitorEnabled || false;
      if (settingsJobSearchEnabled) settingsJobSearchEnabled.checked = settings.jobSearchEnabled || false;
      if (settingsJobSearchQuery) settingsJobSearchQuery.value = settings.jobSearchQuery || "";
      if (settingsJobSearchLocations) settingsJobSearchLocations.value = settings.jobSearchLocations || "";
      if (settingsJobSearchWorkplaceTypes) settingsJobSearchWorkplaceTypes.value = settings.jobSearchWorkplaceTypes || "";
      if (settingsJobSearchKeywords) settingsJobSearchKeywords.value = settings.jobSearchKeywords || "";
      if (settingsJobSearchInterval) settingsJobSearchInterval.value = settings.jobSearchInterval || 10;
      if (settingsJobSearchTimeRange) settingsJobSearchTimeRange.value = settings.jobSearchTimeRange || "r604800";

      updateRespectTimingLabel(settings);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      showToast("Error loading system settings", "error");
    }
  }

  function updateRespectTimingLabel(settings) {
    const label = document.querySelector("label[for='formRespectTiming']");
    if (!label) return;
    const start = settings.timingStartHour !== undefined ? settings.timingStartHour : 9;
    const end = settings.timingEndHour !== undefined ? settings.timingEndHour : 17;
    const fmt = (h) => {
      if (h === 0) return "12 AM";
      if (h === 12) return "12 PM";
      return h > 12 ? `${h - 12} PM` : `${h} AM`;
    };
    label.innerText = `Respect Timing (Send only during business hours: ${fmt(start)} - ${fmt(end)})`;
  }

  async function saveSettings(e) {
    if (e) e.preventDefault();

    const settingsRespectTiming = document.getElementById("settingsRespectTiming");
    const settingsTimingStartHour = document.getElementById("settingsTimingStartHour");
    const settingsTimingEndHour = document.getElementById("settingsTimingEndHour");
    const settingsFollowupInterval = document.getElementById("settingsFollowupInterval");
    const settingsMaxFollowups = document.getElementById("settingsMaxFollowups");
    const settingsDefaultResumeLink = document.getElementById("settingsDefaultResumeLink");
    const settingsVerifierProvider = document.getElementById("settingsVerifierProvider");
    const settingsEnableAiPattern = document.getElementById("settingsEnableAiPattern");
    const settingsGmailMonitor = document.getElementById("settingsGmailMonitor");
    const settingsJobSearchEnabled = document.getElementById("settingsJobSearchEnabled");
    const settingsJobSearchQuery = document.getElementById("settingsJobSearchQuery");
    const settingsJobSearchLocations = document.getElementById("settingsJobSearchLocations");
    const settingsJobSearchWorkplaceTypes = document.getElementById("settingsJobSearchWorkplaceTypes");
    const settingsJobSearchKeywords = document.getElementById("settingsJobSearchKeywords");
    const settingsJobSearchInterval = document.getElementById("settingsJobSearchInterval");
    const settingsJobSearchTimeRange = document.getElementById("settingsJobSearchTimeRange");
    const settingsStatusText = document.getElementById("settingsStatusText");
    const jobSearchSettingsStatusText = document.getElementById("jobSearchSettingsStatusText");

    const payload = {
      respectTiming: settingsRespectTiming ? settingsRespectTiming.checked : false,
      skipWeekends: document.getElementById("settingsSkipWeekends") ? document.getElementById("settingsSkipWeekends").checked : true,
      timingStartHour: settingsTimingStartHour ? parseInt(settingsTimingStartHour.value, 10) : 9,
      timingEndHour: settingsTimingEndHour ? parseInt(settingsTimingEndHour.value, 10) : 17,
      followupIntervalMinutes: settingsFollowupInterval ? parseInt(settingsFollowupInterval.value, 10) : 70,
      maxFollowups: settingsMaxFollowups ? parseInt(settingsMaxFollowups.value, 10) : 3,
      defaultResumeLink: settingsDefaultResumeLink ? settingsDefaultResumeLink.value : "",
      emailVerifierProvider: settingsVerifierProvider ? settingsVerifierProvider.value : "local",
      enableAiPatternDiscovery: settingsEnableAiPattern ? settingsEnableAiPattern.checked : false,
      gmailMonitorEnabled: settingsGmailMonitor ? settingsGmailMonitor.checked : false,
      jobSearchEnabled: settingsJobSearchEnabled ? settingsJobSearchEnabled.checked : false,
      jobSearchQuery: settingsJobSearchQuery ? settingsJobSearchQuery.value : "",
      jobSearchLocations: settingsJobSearchLocations ? settingsJobSearchLocations.value : "",
      jobSearchWorkplaceTypes: settingsJobSearchWorkplaceTypes ? settingsJobSearchWorkplaceTypes.value : "",
      jobSearchKeywords: settingsJobSearchKeywords ? settingsJobSearchKeywords.value : "",
      jobSearchInterval: settingsJobSearchInterval ? parseInt(settingsJobSearchInterval.value, 10) : 10,
      jobSearchTimeRange: settingsJobSearchTimeRange ? settingsJobSearchTimeRange.value : "r604800",
    };

    try {
      const res = await fetch("/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const updated = await res.json();
        state.settings = updated;
        showToast("System settings saved successfully!");
        updateRespectTimingLabel(updated);
        if (settingsStatusText) {
          settingsStatusText.innerText = "Settings saved successfully.";
          settingsStatusText.classList.remove("error");
          settingsStatusText.classList.add("show");
          setTimeout(() => settingsStatusText.classList.remove("show"), 3000);
        }
        if (jobSearchSettingsStatusText) {
          jobSearchSettingsStatusText.innerText = "Settings saved successfully.";
          jobSearchSettingsStatusText.classList.remove("error");
          jobSearchSettingsStatusText.classList.add("show");
          setTimeout(() => jobSearchSettingsStatusText.classList.remove("show"), 3000);
        }
      } else {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update settings");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      showToast("Failed to save settings: " + err.message, "error");
      if (settingsStatusText) {
        settingsStatusText.innerText = "Failed to save: " + err.message;
        settingsStatusText.classList.add("error", "show");
        setTimeout(() => settingsStatusText.classList.remove("show"), 5000);
      }
      if (jobSearchSettingsStatusText) {
        jobSearchSettingsStatusText.innerText = "Failed to save: " + err.message;
        jobSearchSettingsStatusText.classList.add("error", "show");
        setTimeout(() => jobSearchSettingsStatusText.classList.remove("show"), 5000);
      }
    }
  }

  // Hook settings and job search tab button
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const dataTab = btn.getAttribute("data-tab");
      if (dataTab === "tab-settings" || dataTab === "tab-job-search") {
        await fetchSettings();
      }
      if (dataTab === "tab-job-search") {
        await fetchApplications().then(renderApplications);
      }
    });
  });

  // Settings Form Submission
  const settingsForm = document.getElementById("settingsForm");
  if (settingsForm) {
    settingsForm.addEventListener("submit", saveSettings);
  }
  const jobSearchSettingsForm = document.getElementById("jobSearchSettingsForm");
  if (jobSearchSettingsForm) {
    jobSearchSettingsForm.addEventListener("submit", saveSettings);
  }

  // ─── EXCEL COMPANY IMPORT CONTROLLER ─────────────────────────────────────

  (function initExcelImport() {
    const dropZone        = document.getElementById("excelDropZone");
    const browseBtn       = document.getElementById("excelBrowseBtn");
    const fileInput       = document.getElementById("excelFileInput");
    const fileNameEl      = document.getElementById("excelFileName");
    const colSelectorGrp  = document.getElementById("excelColumnSelectorGroup");
    const colSelect       = document.getElementById("excelColumnSelect");
    const rowCountEl      = document.getElementById("excelRowCount");
    const previewGroup    = document.getElementById("excelPreviewGroup");
    const previewHead     = document.getElementById("excelPreviewHead");
    const previewBody     = document.getElementById("excelPreviewBody");
    const importActions   = document.getElementById("excelImportActions");
    const importBtn       = document.getElementById("excelImportBtn");
    const importStatus    = document.getElementById("excelImportStatus");
    const resultCard      = document.getElementById("excelResultCard");
    const resultSummary   = document.getElementById("excelResultSummary");
    const roleInput       = document.getElementById("excelRoleInput");
    const openLinkedinBtn = document.getElementById("excelOpenLinkedinBtn");
    const copyLinkedinBtn = document.getElementById("excelCopyLinkedinBtn");

    if (!dropZone) return; // tab not in DOM

    let parsedRows = [];    // all data rows from the sheet
    let headers    = [];    // column header names
    let importedCompanies = []; // result from backend

    // ── Drag & drop styling ──
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.style.borderColor = "var(--color-accent)"; dropZone.style.background = "rgba(99,102,241,0.08)"; });
    dropZone.addEventListener("dragleave", () => { dropZone.style.borderColor = ""; dropZone.style.background = ""; });
    dropZone.addEventListener("drop", e => {
      e.preventDefault();
      dropZone.style.borderColor = ""; dropZone.style.background = "";
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    browseBtn.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("click", e => { if (e.target !== browseBtn) fileInput.click(); });
    fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    function handleFile(file) {
      fileNameEl.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "binary" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

          if (!data || data.length < 2) {
            showToast("File appears empty or has no data rows.", "error");
            return;
          }

          headers = (data[0] || []).map(h => String(h).trim());
          parsedRows = data.slice(1).filter(row => row.some(cell => String(cell).trim() !== ""));

          // Populate column selector — auto-select column whose header looks like "company"
          colSelect.innerHTML = headers.map((h, i) =>
            `<option value="${i}">${h || `Column ${i + 1}`}</option>`
          ).join("");
          const autoIdx = headers.findIndex(h => /company|organisation|organization|name|firm/i.test(h));
          if (autoIdx >= 0) colSelect.value = autoIdx;

          rowCountEl.textContent = `${parsedRows.length} data rows detected`;
          colSelectorGrp.style.display = "block";
          renderPreview();
          importActions.style.display = "flex";
          resultCard.style.display = "none";
        } catch (err) {
          showToast("Failed to parse file: " + err.message, "error");
        }
      };
      reader.readAsBinaryString(file);
    }

    colSelect.addEventListener("change", renderPreview);

    function renderPreview() {
      const colIdx = parseInt(colSelect.value, 10);
      // Show all columns in preview, highlight selected
      previewHead.innerHTML = headers.map((h, i) =>
        `<th style="${i === colIdx ? 'color:var(--color-accent);font-weight:700;' : ''}">${escHtml(h || `Col ${i+1}`)}</th>`
      ).join("");
      const preview = parsedRows.slice(0, 10);
      previewBody.innerHTML = preview.map(row =>
        `<tr>${headers.map((_, i) =>
          `<td style="${i === colIdx ? 'color:var(--color-accent);font-weight:600;' : ''}">${escHtml(String(row[i] ?? ""))}</td>`
        ).join("")}</tr>`
      ).join("");
      previewGroup.style.display = "block";
    }

    // ── Import to backend ──
    importBtn.addEventListener("click", async () => {
      const colIdx = parseInt(colSelect.value, 10);
      const companies = parsedRows
        .map(row => String(row[colIdx] ?? "").trim())
        .filter(name => name.length > 1);

      if (companies.length === 0) {
        showToast("No company names found in the selected column.", "error");
        return;
      }

      importBtn.disabled = true;
      importBtn.textContent = "⏳ Importing...";
      importStatus.textContent = `Processing ${companies.length} companies...`;

      const payload = companies.map(name => ({ name }));

      try {
        const res = await fetch("/admin/companies/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (result.success) {
          importedCompanies = result.companies || [];
          resultSummary.innerHTML =
            `✅ <strong>${result.added}</strong> new companies added &nbsp;·&nbsp; ` +
            `<span style="color:var(--color-text-muted)">${result.skipped}</span> already existed &nbsp;·&nbsp; ` +
            `<strong>${result.total}</strong> total processed`;
          resultCard.style.display = "block";
          showToast(`Imported ${result.added} companies!`);
          importStatus.textContent = "";
        } else {
          showToast(result.error || "Import failed", "error");
          importStatus.textContent = "";
        }
      } catch (err) {
        showToast("Server error: " + err.message, "error");
        importStatus.textContent = "";
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = "🚀 Import Companies to Portal";
      }
    });

    // ── Generate per-company LinkedIn search links ──
    function buildCompanyUrl(companyName, role) {
      const keywords = encodeURIComponent(`${role} ${companyName}`);
      return `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=India&f_TPR=r2592000&sortBy=DD`;
    }

    function renderLinkedInLinks() {
      const role = (roleInput ? roleInput.value.trim() : "") || "DevOps Engineer";
      const names = importedCompanies.map(c => c.name);
      if (names.length === 0) return;

      // Find or create the links container inside resultCard
      let linksSection = document.getElementById("excelLinksSection");
      if (!linksSection) {
        linksSection = document.createElement("div");
        linksSection.id = "excelLinksSection";
        resultCard.appendChild(linksSection);
      }

      linksSection.innerHTML = `
        <div style="margin-top: 16px; border-top: 1px solid rgba(99,102,241,0.2); padding-top: 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
            <span style="font-size:13px; font-weight:600; color:var(--color-text-bright);">
              🔗 LinkedIn search links — one per company (${names.length} total)
            </span>
            <span style="font-size:11px; color:var(--color-text-muted);">Click any link to open LinkedIn Jobs</span>
          </div>
          <div style="max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px;">
            ${names.map((name, i) => `
              <a href="${buildCompanyUrl(name, role)}" target="_blank" rel="noopener"
                 style="display:flex; align-items:center; gap: 10px; padding: 8px 12px; border-radius: 8px;
                        background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.12);
                        color: var(--color-accent); text-decoration: none; font-size: 13px;
                        transition: background 0.15s, border-color 0.15s;"
                 onmouseover="this.style.background='rgba(99,102,241,0.14)';this.style.borderColor='rgba(99,102,241,0.3)'"
                 onmouseout="this.style.background='rgba(99,102,241,0.06)';this.style.borderColor='rgba(99,102,241,0.12)'">
                <span style="color:var(--color-text-muted); font-size:11px; min-width:24px;">${i + 1}.</span>
                <span style="flex:1; color:var(--color-text-bright); font-weight:500;">${escHtml(name)}</span>
                <span style="font-size:11px; opacity:0.6;">↗ Search ${escHtml(role)} jobs</span>
              </a>`).join("")}
          </div>
        </div>`;
    }

    // Re-render links whenever role changes
    if (roleInput) {
      roleInput.addEventListener("input", () => {
        if (importedCompanies.length > 0 && resultCard.style.display !== "none") {
          renderLinkedInLinks();
        }
      });
    }

    // "Open Targeted LinkedIn Search" → now just renders links (no popup)
    openLinkedinBtn.addEventListener("click", () => {
      if (importedCompanies.length === 0) { showToast("Import companies first.", "error"); return; }
      renderLinkedInLinks();
      showToast(`${importedCompanies.length} search links generated below ↓`);
    });

    copyLinkedinBtn.addEventListener("click", () => {
      if (importedCompanies.length === 0) { showToast("Import companies first.", "error"); return; }
      const role = (roleInput ? roleInput.value.trim() : "") || "DevOps Engineer";
      const allUrls = importedCompanies.map(c => `${c.name}: ${buildCompanyUrl(c.name, role)}`).join("\n");
      navigator.clipboard.writeText(allUrls)
        .then(() => showToast("All search URLs copied to clipboard!"))
        .catch(() => showToast("Failed to copy.", "error"));
    });
  })();

  // ─────────────────────────────────────────────────────────────────────────

  // Initial Bootup
  fetchSettings();
  fetchApplications().then(renderApplications);
  updateUI();

  if (persistedTabId === "tab-backup") {
    fetchBackups();
  } else if (persistedTabId === "tab-templates") {
    fetchTemplates().then(renderTemplatesList);
  } else if (persistedTabId === "tab-settings" || persistedTabId === "tab-job-search") {
    fetchSettings();
  }

  // Periodic Reactive UI State Hook: refresh tables and logs automatically every 5 seconds!
  setInterval(() => {
    fetchSummary().then(renderMetrics);
    fetchLeads().then(renderLeadsTable);
    fetchEvents().then(renderTimelineLogs);
    fetchQueue().then(renderQueueTable);
    fetchApplications().then(renderApplications);
    updateGoogleStatus();
    checkGmailQuotaStatus();
  }, 5000);
});
