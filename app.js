(function () {
  "use strict";

  const SUPABASE_URL = "https://ofpuxxtillwyueqdonoc.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8gsop_fa_WVSN37O8o1lXw_sP47-erf";
  const ROLES = [
    { id: "ovr", name: "OVR", mark: "OVR", weight: 1 },
    { id: "clock", name: "Klockan", mark: "TID", weight: 1 },
    { id: "speaker", name: "Speaker", mark: "MIC", weight: 1 },
    { id: "host", name: "Matchvärd / fika", mark: "FIKA", weight: 1 },
    { id: "door1", name: "Båsdörr 1", mark: "DÖRR", weight: 0.75 },
    { id: "door2", name: "Båsdörr 2", mark: "DÖRR", weight: 0.75 }
  ];

  const emptyState = () => ({ parents: [], availableIds: [], matches: [] });
  let state = emptyState();
  let latestResultId = null;
  let currentUser = null;
  let currentTeam = null;
  let client = null;
  let noticeTimer = null;
  let refreshInProgress = false;

  const $ = (selector) => document.querySelector(selector);
  const notice = $("#notice");
  const TEAMS = {
    u12: "HV71 U12",
    u13: "HV71 U13",
    u14: "HV71 U14",
    u15: "HV71 U15P",
    u16: "HV71 U16"
  };

  function setTeamView(teamId) {
    const teamName = TEAMS[teamId] || "Okänt lag";
    $("#account-team").textContent = teamName;
    $(".crest strong").textContent = "HV71";
    $(".crest span").textContent = teamId === "u15" ? "U15P" : teamId.toUpperCase();
    $(".eyebrow").textContent = teamName;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showNotice(message, isError) {
    window.clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.classList.toggle("error", Boolean(isError));
    notice.hidden = false;
    if (!isError) {
      noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 6500);
    }
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function formatDate(dateString) {
    if (!dateString) return "Datum saknas";
    const parts = dateString.split("-");
    if (parts.length !== 3) return dateString;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (Number.isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function getRole(roleId) {
    return ROLES.find((role) => role.id === roleId);
  }

  function calculateScores() {
    const scores = new Map(state.parents.map((parent) => [parent.id, 0]));
    state.matches.forEach((match) => {
      match.assignments.forEach((assignment) => {
        const role = getRole(assignment.roleId);
        if (role && scores.has(assignment.parentId)) {
          scores.set(assignment.parentId, scores.get(assignment.parentId) + role.weight);
        }
      });
    });
    return scores;
  }

  function renderParents() {
    const list = $("#parent-list");
    const selected = new Set(state.availableIds);
    $("#parent-count").textContent = state.parents.length
      ? " " + state.parents.length + (state.parents.length === 1 ? " sparad förälder." : " sparade föräldrar.")
      : " Lägg till föräldrar här nedan.";
    $("#available-count").textContent = state.availableIds.length + (state.availableIds.length === 1 ? " tillgänglig" : " tillgängliga");

    if (!state.parents.length) {
      list.innerHTML = '<p class="empty-copy">Du har inte lagt till några föräldrar ännu. Lägg till dem en gång, så finns de kvar till nästa match.</p>';
      return;
    }

    list.innerHTML = state.parents.map((parent) => {
      const isSelected = selected.has(parent.id);
      const checkboxId = "available-" + parent.id;
      return '<div class="parent-row' + (isSelected ? " selected" : "") + '">' +
        '<input id="' + escapeHtml(checkboxId) + '" type="checkbox" data-parent-id="' + escapeHtml(parent.id) + '"' + (isSelected ? " checked" : "") + ' aria-label="Markera ' + escapeHtml(parent.name) + " som tillgänglig\">" +
        '<label class="parent-name" for="' + escapeHtml(checkboxId) + '">' + escapeHtml(parent.name) + '</label>' +
        '<button class="remove-parent" type="button" data-remove-id="' + escapeHtml(parent.id) + '" aria-label="Ta bort ' + escapeHtml(parent.name) + '" title="Ta bort">×</button>' +
        "</div>";
    }).join("");
  }

  function renderResult() {
    const result = $("#result");
    const match = state.matches.find((item) => item.id === latestResultId);
    if (!match) {
      $("#result-subtitle").textContent = "Resultatet visas här när du har lottat.";
      result.innerHTML = '<div class="result-empty">Välj tillgängliga föräldrar och tryck på <strong>Slumpa uppdrag</strong> för att fördela rollerna.</div>';
      return;
    }

    $("#result-subtitle").textContent = match.opponent + " · " + formatDate(match.date);
    const assignmentsByRole = new Map(match.assignments.map((assignment) => [assignment.roleId, assignment]));
    result.innerHTML = '<p class="result-meta">Lottningens resultat visas här.</p><div class="role-list">' +
      ROLES.map((role) => {
        const assignment = assignmentsByRole.get(role.id);
        const name = assignment ? assignment.parentName : "";
        const hasEditButton = assignment && state.parents.length > 1;
        return '<div class="role-item' + (assignment ? "" : " open") + '">' +
          '<span class="role-icon" aria-hidden="true">' + escapeHtml(role.mark) + '</span>' +
          '<div><div class="role-name">' + escapeHtml(role.name) + '</div>' +
          '<div class="role-person">' + (assignment ? escapeHtml(name) : "Behöver bemannas") + '</div></div>' +
          '<div class="role-actions">' +
          '<span class="role-status">' + (assignment ? "Tilldelad" : "Ledig") + '</span>' +
          (hasEditButton ? '<button class="edit-assignment" type="button" data-match-id="' + escapeHtml(match.id) + '" data-role-id="' + escapeHtml(role.id) + '" aria-label="Redigera ' + escapeHtml(role.name) + '" title="Redigera">Redigera</button>' : '') +
          '</div>' +
          '</div>';
      }).join("") + "</div>";
  }

  function renderStats() {
    const stats = $("#parent-stats");
    const scores = calculateScores();
    $("#match-count").textContent = state.matches.length + (state.matches.length === 1 ? " match" : " matcher");
    if (!state.parents.length) {
      stats.innerHTML = '<div class="empty-state">Lägg till föräldrar för att börja samla uppdragshistorik.</div>';
      return;
    }

    const counts = new Map(state.parents.map((parent) => [parent.id, 0]));
    state.matches.forEach((match) => match.assignments.forEach((assignment) => {
      if (counts.has(assignment.parentId)) counts.set(assignment.parentId, counts.get(assignment.parentId) + 1);
    }));
    const ordered = state.parents.slice().sort((a, b) => {
      const scoreDifference = scores.get(a.id) - scores.get(b.id);
      return scoreDifference || a.name.localeCompare(b.name, "sv");
    });
    stats.innerHTML = ordered.map((parent) => {
      const score = scores.get(parent.id);
      return '<div class="stat-row"><span>' + escapeHtml(parent.name) + '</span>' +
        '<span class="stat-detail">' + counts.get(parent.id) + ' uppdrag · ' + score.toFixed(2).replace(".", ",") + ' p</span></div>';
    }).join("");
  }

  function renderHistory() {
    const container = $("#history-list");
    const clearButton = $("#clear-history");
    clearButton.hidden = !state.matches.length;
    if (!state.matches.length) {
      container.innerHTML = '<div class="empty-state">Här visas sparade lottningar.</div>';
      return;
    }
    container.innerHTML = state.matches.slice(0, 8).map((match) => {
      const filled = match.assignments.length;
      const names = match.assignments.map((assignment) => assignment.parentName).join(", ");
      return '<div class="history-item"><div class="history-top"><span>' + escapeHtml(match.opponent) + '</span>' +
        '<span class="history-date">' + escapeHtml(formatDate(match.date)) + '</span></div>' +
        '<div class="history-assignments">' + filled + '/6 uppdrag · ' + escapeHtml(names || "Inga tilldelade") + '</div>' +
        '<div class="history-actions">' +
        '<button class="edit-history" type="button" data-match-id="' + escapeHtml(match.id) + '" aria-label="Redigera" title="Redigera">Redigera</button>' +
        '<button class="delete-history" type="button" data-match-id="' + escapeHtml(match.id) + '" aria-label="Ta bort" title="Ta bort">Ta bort</button>' +
        '</div></div>';
    }).join("");
  }

  function render() {
    renderParents();
    renderResult();
    renderStats();
    renderHistory();
  }

  function setAvailable(ids) {
    state.availableIds = Array.from(new Set(ids));
    renderParents();
  }

  function weightedPick(candidates, scores) {
    const weights = candidates.map((parent) => 1 / Math.pow(1 + (scores.get(parent.id) || 0), 2));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.random() * total;
    for (let index = 0; index < candidates.length; index += 1) {
      target -= weights[index];
      if (target <= 0) return candidates[index];
    }
    return candidates[candidates.length - 1];
  }

  async function refreshCloudState(showSuccess) {
    if (!client || !currentUser || refreshInProgress) return false;
    refreshInProgress = true;
    try {
      const membershipResult = await client
        .from("team_members")
        .select("team_id")
        .eq("user_id", currentUser.id)
        .maybeSingle();
      if (membershipResult.error) throw membershipResult.error;
      if (!membershipResult.data) {
        throw new Error("Kontot har inte lagts till som lagmedlem ännu. Be administratören ge kontot åtkomst i Supabase.");
      }
      currentTeam = membershipResult.data.team_id;
      setTeamView(currentTeam);

      const results = await Promise.all([
        client.from("parents").select("id,name").eq("team_id", currentTeam).order("name"),
        client.from("matches").select("id,opponent,match_date,created_at").eq("team_id", currentTeam).order("created_at", { ascending: false }),
        client.from("assignments").select("match_id,role_id,parent_id,parent_name").eq("team_id", currentTeam)
      ]);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;

      const previousAvailable = new Set(state.availableIds);
      const parents = results[0].data;
      const matchRows = results[1].data;
      const assignmentRows = results[2].data;
      const matchMap = new Map(matchRows.map((row) => [row.id, {
        id: row.id,
        opponent: row.opponent,
        date: row.match_date,
        createdAt: row.created_at,
        assignments: []
      }]));

      assignmentRows.forEach((row) => {
        const match = matchMap.get(row.match_id);
        if (match) {
          match.assignments.push({
            roleId: row.role_id,
            parentId: row.parent_id,
            parentName: row.parent_name
          });
        }
      });

      state = {
        parents: parents,
        availableIds: parents.filter((parent) => previousAvailable.has(parent.id)).map((parent) => parent.id),
        matches: Array.from(matchMap.values())
      };
      if (!state.matches.some((match) => match.id === latestResultId)) {
        latestResultId = state.matches.length ? state.matches[0].id : null;
      }
      render();
      $("#app-layout").hidden = false;
      if (showSuccess) showNotice("Informationen har synkats.", false);
      return true;
    } catch (error) {
      console.error("Kunde inte synka data från Supabase.", error);
      showNotice("Kunde inte läsa lagets data: " + error.message + " Kontrollera att SQL-installationen är gjord och försök igen.", true);
      return false;
    } finally {
      refreshInProgress = false;
    }
  }

  function updateAuthView(user) {
    currentUser = user;
    const signedIn = Boolean(user);
    if (!signedIn) currentTeam = null;
    $("#auth-card").hidden = signedIn;
    $("#account-bar").hidden = !signedIn;
    $("#account-email").textContent = signedIn ? user.email : "";
    $("#app-layout").hidden = signedIn;

    if (!signedIn) {
      state = emptyState();
      latestResultId = null;
      render();
      return;
    }

    window.setTimeout(() => { refreshCloudState(false); }, 0);
  }

  function showRequestError(action, error) {
    console.error(action, error);
    showNotice(action + ": " + error.message, true);
  }

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client) {
      showNotice("Supabase-klienten kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.", true);
      return;
    }
    if (window.location.protocol === "file:") {
      showNotice("Öppna appen via dess publicerade webbadress innan du loggar in. En lokal HTML-fil kan inte ansluta till kontot på ett säkert sätt.", true);
      return;
    }

    const button = $("#login-button");
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    button.disabled = true;
    button.textContent = "Loggar in…";
    try {
      const { error } = await client.auth.signInWithPassword({
        email: email,
        password: password
      });
      if (error) throw error;
      showNotice("Du är inloggad.", false);
    } catch (error) {
      showRequestError("Inloggningen misslyckades", error);
    } finally {
      button.disabled = false;
      button.textContent = "Logga in";
    }
  });

  $("#refresh-button").addEventListener("click", () => { refreshCloudState(true); });

  $("#signout-button").addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) showRequestError("Kunde inte logga ut", error);
  });

  $("#add-parent-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#parent-name-input");
    const name = input.value.trim();
    if (!name) {
      showNotice("Skriv ett namn innan du lägger till en förälder.", true);
      input.focus();
      return;
    }
    if (state.parents.some((parent) => parent.name.toLocaleLowerCase("sv") === name.toLocaleLowerCase("sv"))) {
      showNotice("Den föräldern finns redan i listan.", true);
      input.focus();
      return;
    }

    if (!currentTeam) {
      showNotice("Lagmedlemskapet kunde inte läsas. Synka sidan och försök igen.", true);
      return;
    }
    const { error } = await client.from("parents").insert({ name: name, team_id: currentTeam });
    if (error) {
      showRequestError("Kunde inte lägga till föräldern", error);
      return;
    }
    input.value = "";
    if (await refreshCloudState(false)) {
      showNotice("Föräldern har lagts till och synkats.", false);
      input.focus();
    }
  });

  $("#parent-list").addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-parent-id]");
    if (!checkbox) return;
    const selected = new Set(state.availableIds);
    if (checkbox.checked) selected.add(checkbox.dataset.parentId);
    else selected.delete(checkbox.dataset.parentId);
    setAvailable(Array.from(selected));
  });

  $("#parent-list").addEventListener("click", async (event) => {
    const removeButton = event.target.closest("button[data-remove-id]");
    if (!removeButton) return;
    const id = removeButton.dataset.removeId;
    const parent = state.parents.find((item) => item.id === id);
    if (!parent || !window.confirm("Ta bort " + parent.name + " från föräldralistan? Tidigare matchhistorik behålls.")) return;
    const { error } = await client.from("parents").delete().eq("id", id).eq("team_id", currentTeam);
    if (error) {
      showRequestError("Kunde inte ta bort föräldern", error);
      return;
    }
    await refreshCloudState(false);
  });

  $("#select-all").addEventListener("click", () => setAvailable(state.parents.map((parent) => parent.id)));
  $("#select-none").addEventListener("click", () => setAvailable([]));

  $("#draw-button").addEventListener("click", async () => {
    const opponent = $("#opponent").value.trim();
    if (!opponent) {
      showNotice("Fyll i motståndare innan du lottar.", true);
      $("#opponent").focus();
      return;
    }
    const available = state.parents.filter((parent) => state.availableIds.includes(parent.id));
    if (!available.length) {
      showNotice("Markera minst en tillgänglig förälder innan du lottar.", true);
      return;
    }

    const scores = calculateScores();
    const remaining = available.slice();
    const assignments = [];
    ROLES.slice().sort((a, b) => b.weight - a.weight).forEach((role) => {
      if (!remaining.length) return;
      const chosen = weightedPick(remaining, scores);
      assignments.push({ role_id: role.id, parent_id: chosen.id });
      remaining.splice(remaining.findIndex((parent) => parent.id === chosen.id), 1);
    });

    const { data: matchId, error } = await client.rpc("create_match_with_assignments", {
      p_opponent: opponent,
      p_match_date: $("#match-date").value || localDateString(new Date()),
      p_assignments: assignments
    });
    if (error) {
      showRequestError("Kunde inte spara lottningen", error);
      return;
    }
    latestResultId = matchId;
    if (!(await refreshCloudState(false))) return;
    if (assignments.length < ROLES.length) {
      showNotice("Lottningen är klar, men " + (ROLES.length - assignments.length) + " uppdrag är obemannade. Lägg till eller markera fler tillgängliga föräldrar.", false);
    } else {
      showNotice("Uppdragen är lottade och synkade med laget.", false);
    }
  });

  $("#clear-history").addEventListener("click", async () => {
    if (!state.matches.length || !window.confirm("Rensa all matchhistorik för laget? Uppdragspoängen nollställs.")) return;
    const matchIds = state.matches.map((match) => match.id);
    const { error } = await client.from("matches").delete().in("id", matchIds).eq("team_id", currentTeam);
    if (error) {
      showRequestError("Kunde inte rensa matchhistoriken", error);
      return;
    }
    latestResultId = null;
    if (await refreshCloudState(false)) showNotice("Matchhistoriken har rensats för alla användare.", false);
  });

  $("#result").addEventListener("click", async (event) => {
    const editButton = event.target.closest("button.edit-assignment");
    if (!editButton) return;
    const matchId = editButton.dataset.matchId;
    const roleId = editButton.dataset.roleId;
    const match = state.matches.find((m) => m.id === matchId);
    if (!match) return;
    const role = getRole(roleId);
    if (!role) return;
    const assignment = match.assignments.find((a) => a.roleId === roleId);
    
    const availableParents = state.parents.filter((p) => !match.assignments.some((a) => a.parentId === p.id && a.roleId !== roleId));
    if (!availableParents.length) {
      showNotice("Inga föräldrar tillgängliga för denna roll.", true);
      return;
    }

    const selectedName = assignment ? assignment.parentName : availableParents[0].name;
    const parentOptions = availableParents.map((p) => p.name).join(",");
    const newParent = window.prompt("Välj förälder för " + role.name + ":\n\n" + parentOptions, selectedName);
    if (!newParent || newParent === selectedName) return;

    const newParentId = availableParents.find((p) => p.name === newParent)?.id;
    if (!newParentId) {
      showNotice("Föräldern hittades inte.", true);
      return;
    }

    if (assignment) {
      const { error } = await client.from("assignments").update({ parent_id: newParentId, parent_name: newParent }).eq("match_id", matchId).eq("role_id", roleId).eq("team_id", currentTeam);
      if (error) {
        showRequestError("Kunde inte uppdatera uppdraget", error);
        return;
      }
    } else {
      const { error } = await client.from("assignments").insert({ match_id: matchId, role_id: roleId, parent_id: newParentId, parent_name: newParent, team_id: currentTeam });
      if (error) {
        showRequestError("Kunde inte lägga till uppdraget", error);
        return;
      }
    }

    await refreshCloudState(false);
    showNotice("Uppdraget har uppdaterats.", false);
  });

  $("#history-list").addEventListener("click", async (event) => {
    const editButton = event.target.closest("button.edit-history");
    if (editButton) {
      const matchId = editButton.dataset.matchId;
      const match = state.matches.find((m) => m.id === matchId);
      if (!match) return;
      latestResultId = matchId;
      render();
      return;
    }

    const deleteButton = event.target.closest("button.delete-history");
    if (!deleteButton) return;
    const matchId = deleteButton.dataset.matchId;
    const match = state.matches.find((m) => m.id === matchId);
    if (!match || !window.confirm("Ta bort matchen " + match.opponent + "?")) return;

    const { error } = await client.from("matches").delete().eq("id", matchId).eq("team_id", currentTeam);
    if (error) {
      showRequestError("Kunde inte ta bort matchen", error);
      return;
    }

    if (latestResultId === matchId) latestResultId = null;
    if (await refreshCloudState(false)) showNotice("Matchen har tagits bort.", false);
  });

  $("#match-date").value = localDateString(new Date());
  render();

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showNotice("Supabase-klienten kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.", true);
    return;
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  client.auth.onAuthStateChange((_event, session) => {
    const nextUser = session ? session.user : null;
    const userChanged = (currentUser && currentUser.id) !== (nextUser && nextUser.id);
    if (userChanged) updateAuthView(nextUser);
    else currentUser = nextUser;
  });

  window.addEventListener("focus", () => { refreshCloudState(false); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshCloudState(false);
  });
}());
