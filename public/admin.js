const statusEl = document.querySelector("#status");
const metricsEl = document.querySelector("#metrics");
const leadsEl = document.querySelector("#leads");
const companiesEl = document.querySelector("#companies");
const eventsEl = document.querySelector("#events");
const refreshButton = document.querySelector("#refreshButton");

// Gmail elements
const pollGmailButton = document.querySelector("#pollGmailButton");
const simulateEmailInput = document.querySelector("#simulateEmailInput");
const simulateBounceButton = document.querySelector("#simulateBounceButton");

refreshButton.addEventListener("click", load);
pollGmailButton.addEventListener("click", handleGmailPoll);
simulateBounceButton.addEventListener("click", handleBounceSimulation);

load();

async function load() {
  setStatus("Loading data...");
  try {
    const [summary, leads, companies, events] = await Promise.all([
      getJson("/admin/summary"),
      getJson("/admin/leads"),
      getJson("/admin/companies"),
      getJson("/admin/events")
    ]);

    renderMetrics(summary);
    renderLeads(leads);
    renderCompanies(companies);
    renderEvents(events);
    setStatus(`System live · Updated at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setStatus(error instanceof Error ? `Error: ${error.message}` : "Failed to load dashboard data");
  }
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Request failed: ${url}`);
  }
  return data;
}

async function handleGmailPoll() {
  const originalText = pollGmailButton.textContent;
  pollGmailButton.textContent = "Polling Gmail...";
  pollGmailButton.disabled = true;
  setStatus("Querying Google Gmail API...");

  try {
    const result = await postJson("/admin/gmail/poll");
    if (result.success) {
      alert(`Gmail Poll Complete!\n${result.message}\nBounces detected: ${result.bouncesFound.length > 0 ? result.bouncesFound.join(", ") : "None"}`);
    } else {
      alert(`Gmail Poll finished: ${result.message}`);
    }
    await load();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to query Gmail API");
    setStatus("Gmail polling failed");
  } finally {
    pollGmailButton.textContent = originalText;
    pollGmailButton.disabled = false;
  }
}

async function handleBounceSimulation() {
  const email = simulateEmailInput.value.trim();
  if (!email) {
    alert("Please enter a valid candidate email to bounce.");
    return;
  }

  const originalText = simulateBounceButton.textContent;
  simulateBounceButton.textContent = "Simulating...";
  simulateBounceButton.disabled = true;
  setStatus(`Sending mock bounce event for ${email}...`);

  try {
    const result = await postJson("/admin/gmail/simulate", { email });
    alert(result.message);
    simulateEmailInput.value = "";
    await load();
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to simulate bounce");
    setStatus("Bounce simulation failed");
  } finally {
    simulateBounceButton.textContent = originalText;
    simulateBounceButton.disabled = false;
  }
}

function renderMetrics(summary) {
  metricsEl.replaceChildren(
    metric("Companies", summary.companyCount),
    metric("Leads", summary.leadCount),
    metric("Candidates", summary.candidateCount),
    metric("Selected", summary.selectedCandidateCount),
    metric("Events", summary.eventCount),
    metric("Suppressions", summary.suppressionCount)
  );
}

function metric(label, value) {
  const el = document.createElement("article");
  el.className = "metric";
  el.innerHTML = `<div class="muted">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(String(value))}</div>`;
  return el;
}

function renderLeads(leads) {
  leadsEl.replaceChildren(
    ...leads.map((lead) => {
      const selected = lead.candidates.find((candidate) => candidate.selected);
      const row = document.createElement("article");
      row.className = "row";
      row.innerHTML = `
        <div class="row-title">${escapeHtml(lead.fullName)} <span class="muted">at ${escapeHtml(lead.company.name)}</span></div>
        <div class="row-grid">
          <div><span class="muted">Domain:</span> <strong>${escapeHtml(lead.company.domain ?? "None")}</strong></div>
          <div><span class="muted">Primary Email:</span> <span class="${selected ? "selected" : ""}">${escapeHtml(selected?.email ?? "None")}</span></div>
          <div class="muted">${escapeHtml(new Date(lead.createdAt).toLocaleString())}</div>
        </div>
        <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 8px;">
          ${lead.candidates
            .slice(0, 5)
            .map(
              (candidate) =>
                `<div class="candidate">
                  <span>${escapeHtml(candidate.email)}</span>
                  <span>
                    <span class="muted">${escapeHtml(candidate.algorithm.key)}</span> · 
                    <strong>${escapeHtml(candidate.verifierStatus ?? "unknown")}</strong>
                  </span>
                </div>`
            )
            .join("")}
        </div>
      `;
      return row;
    })
  );
}

function renderCompanies(companies) {
  companiesEl.replaceChildren(
    ...companies.map((company) => {
      const row = document.createElement("article");
      row.className = "row";
      row.innerHTML = `
        <div><strong>${escapeHtml(company.name)}</strong><div class="muted">${escapeHtml(company.domain ?? "No domain")}</div></div>
        <div><strong>${escapeHtml(String(company.domainConfidence))}%</strong> <span class="muted">confidence</span></div>
        <div class="muted">${escapeHtml(String(company._count.leads))} leads · ${escapeHtml(String(company._count.algorithms))} patterns</div>
      `;
      return row;
    })
  );
}

function renderEvents(events) {
  eventsEl.replaceChildren(
    ...events.map((event) => {
      const row = document.createElement("article");
      row.className = "row";
      
      let badgeClass = "badge-other";
      if (event.eventType === "bounce") {
        badgeClass = "badge-bounce";
      } else if (event.eventType === "delivery" || event.eventType === "reply") {
        badgeClass = "badge-delivery";
      }

      row.innerHTML = `
        <div>
          <span class="${badgeClass}">${escapeHtml(event.eventType.toUpperCase())}</span>
          <span class="muted" style="margin-left: 8px;">via ${escapeHtml(event.provider)}</span>
        </div>
        <div><strong>${escapeHtml(event.candidate.email)}</strong></div>
        <div class="muted">${escapeHtml(new Date(event.createdAt).toLocaleString())}</div>
      `;
      return row;
    })
  );
}

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(value) {
  if (!value) return "";
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}
