// Account/process administration. Loaded after app.js and before DOMContentLoaded.
const accountRoleNames = ['QA Auditor', 'QA Reviewer', 'Operations Manager'];
const processPairs = ['sample', 'scorecard', 'policy', 'config'];
const activeProcesses = () => state.processes.filter(p => p.active && p.account_active);
const selectedProcess = prefix => state.processes.find(p => String(p.id) === $(prefix + 'Process').value);
const processLabel = p => `${p.name}${p.active && p.account_active ? '' : ' (Archived)'}`;

function resetAuthenticatedView() {
  closeDetailDialogs();
  for (const id of ['importDialog', 'capaDialog']) if ($(id)?.open) $(id).close();
  state.me = null;
  for (const key of ['accounts', 'processes', 'scorecards', 'audits', 'capas']) state[key] = [];
  for (const key of ['analytics', 'currentAudit', 'currentCapa', 'currentScorecard', 'importPreview', 'editingItem']) state[key] = null;
  for (const key of Object.keys(state.charts)) destroyChart(key);
  document.querySelectorAll('.table-area,.detail-panel,#scorecardCards').forEach(el => el.replaceChildren());
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === 'page-home'));
  document.querySelectorAll('#nav [data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === 'home'));
  document.querySelectorAll('#appView form').forEach(form => form.reset());
  for (const id of ['globalAccount', 'globalProcess', 'sampleAccount', 'sampleProcess']) $(id).replaceChildren();
  for (const id of ['yieldMetric', 'dpmoMetric', 'sigmaMetric', 'criticalMetric']) $(id).textContent = '—';
  $('accountRoleRows').replaceChildren(); $('adminUsername').readOnly = false;
  $('scorecardBuilder').classList.add('hide'); resetSample();
}

function fillOptions(id, rows, empty, label = 'name') {
  const previous = $(id).value;
  $(id).innerHTML = optionRows(rows, 'id', label, empty);
  if (rows.some(r => String(r.id) === previous)) $(id).value = previous;
}

async function refreshMaster() {
  [state.accounts, state.processes] = await Promise.all([
    api('/api/accounts?include_archived=true'), api('/api/admin/processes?include_archived=true')
  ]);
  renderMasterOptions();
  if (hasRole('Administrator')) renderAccountsAdmin();
  await refreshScorecards();
}

function renderMasterOptions() {
  const accounts = state.accounts.filter(a => a.active);
  const historical = state.accounts.map(a => ({...a, label: a.name + (a.active ? '' : ' (Archived)')}));
  fillOptions('globalAccount', historical, 'All accounts', 'label');
  const historyProcesses = state.processes.filter(p => !$('globalAccount').value || String(p.account_id) === $('globalAccount').value);
  fillOptions('globalProcess', historyProcesses.map(p => ({...p, label: processLabel(p)})), 'All processes', 'label');
  fillOptions('processAccount', accounts, 'Select account');
  for (const prefix of processPairs) {
    fillOptions(prefix + 'Account', accounts, 'Select account');
    syncProcessSelect(prefix, false);
  }
  for (const id of ['importProcess', 'newCapaProcess']) {
    const role = id === 'importProcess' ? 'QA Reviewer' : null;
    const rows = activeProcesses().filter(p => role ? hasRole(role, p.account_id) : hasRole('QA Reviewer', p.account_id) || hasRole('Operations Manager', p.account_id));
    fillOptions(id, rows.map(p => ({...p, label: `${p.account_name} / ${p.name}`})), 'Select process', 'label');
  }
}

function syncProcessSelect(prefix, clear = true) {
  const accountId = $(prefix + 'Account').value;
  const select = $(prefix + 'Process');
  if (clear) select.value = '';
  const rows = activeProcesses().filter(p => String(p.account_id) === accountId && (prefix !== 'sample' || hasRole('QA Auditor', p.account_id)));
  fillOptions(prefix + 'Process', rows, rows.length ? 'Select process' : 'No active processes');
  select.disabled = !accountId || !rows.length;
  if (prefix === 'scorecard') {
    $('scorecardForm').querySelector('button').disabled = !select.value;
    if (clear) $('scorecardBuilder').classList.add('hide');
  }
  loadProcessControls(prefix);
}

function setControlsEnabled(formId, enabled, exceptions) {
  $(formId).querySelectorAll('input,select,button,textarea').forEach(el => {
    if (!exceptions.includes(el.id)) el.disabled = !enabled;
  });
}

function loadProcessControls(prefix) {
  const p = selectedProcess(prefix);
  if (prefix === 'policy') {
    setControlsEnabled('policyForm', !!p, ['policyAccount', 'policyProcess']);
    const values = {policyFrequency: p?.sampling_frequency || 'weekly', policyCount: p?.sampling_count ?? 10,
      policyAssignment: p?.assignment_mode || 'unassigned', policySubgroup: p?.subgroup_mode || 'day',
      policyBaseline: p?.baseline_subgroups ?? 20, policyCapaDays: p?.capa_due_days ?? 14};
    for (const [id, value] of Object.entries(values)) $(id).value = value;
    $('policyAutoCapa').checked = !!p?.critical_capa_enabled;
  }
  if (prefix === 'config') {
    setControlsEnabled('accountPolicyForm', !!p, ['configAccount', 'configProcess']);
    const c = p?.sampling_config || {};
    $('cfgCoverage').checked = !!c.coverage_enabled;
    $('cfgPeriod').value = c.coverage_period || 'week';
    $('cfgQuota').value = c.audits_per_associate ?? 3;
    $('cfgExclude').checked = c.exclude_previously_sampled !== 0;
    $('cfgCaseInsensitive').checked = c.case_insensitive_ids !== 0;
  }
  if (prefix === 'sample') {
    const c = p?.sampling_config;
    $('samplePolicy').textContent = c ? `${c.coverage_enabled ? `Coverage: ${c.audits_per_associate} per associate per ${c.coverage_period}. ` : ''}${c.exclude_previously_sampled ? 'Previous identifiers in this process are excluded.' : 'Previous identifiers may be sampled.'}` : 'Select an account and process.';
    invalidateReview();
  }
}

for (const prefix of processPairs) {
  $(prefix + 'Account').addEventListener('change', () => {
    syncProcessSelect(prefix);
    if (prefix === 'scorecard') refreshAdminScorecards();
    if (prefix === 'sample') resetUploadOnly();
  });
  $(prefix + 'Process').addEventListener('change', () => {
    loadProcessControls(prefix);
    if (prefix === 'scorecard') {
      $('scorecardForm').querySelector('button').disabled = !selectedProcess(prefix);
      $('scorecardBuilder').classList.add('hide');
      refreshAdminScorecards();
    }
    if (prefix === 'sample' && state.inspect) inspectUpload();
  });
}

function renderAccountsAdmin() {
  $('accountsTable').innerHTML = tableHtml(state.accounts.filter(a => a.active), [['name', 'Account'], ['created_at', 'Created', fmtDate]],
    r => `<button class="danger small-btn archive-account" data-id="${r.id}">Archive</button>`);
  const rows = state.processes.filter(p => $('showArchivedProcesses').checked || p.active && p.account_active);
  $('processTable').innerHTML = tableHtml(rows, [['account_name', 'Account'], ['name', 'Process'],
    ['process_type', 'Type / target', (v, r) => `${esc(v.replace('_', ' '))}<br>${r.target_yield}%`]],
    r => `${!r.active || !r.account_active ? pill('ARCHIVED') : ''}<button class="${r.active ? 'danger' : 'secondary'} small-btn process-status" data-id="${r.id}" data-action="${r.active ? 'archive' : 'restore'}" ${!r.account_active ? 'disabled' : ''}>${r.active ? 'Archive' : 'Restore'}</button>`);
}
$('showArchivedProcesses').onchange = renderAccountsAdmin;
$('processTable').addEventListener('click', async e => {
  const button = e.target.closest('.process-status');
  if (!button) return;
  if (button.dataset.action === 'archive' && !confirm('Archive this process? New work stops; existing audits and CAPAs can finish.')) return;
  try {
    await api(`/api/admin/processes/${button.dataset.id}/${button.dataset.action}`, {method: 'POST'});
    await refreshMaster(); renderAccountsAdmin();
    toast(button.dataset.action === 'archive' ? 'Process archived.' : 'Process restored.');
  } catch (error) { toast(error.message, true); }
});

function addAccountRoleRow(grant = {roles: []}) {
  const row = document.createElement('div');
  row.className = 'account-role-row';
  row.innerHTML = `<label>Account<select class="grant-account" required>${optionRows(state.accounts)}</select></label>
    <div class="check-grid">${accountRoleNames.map(role => `<label class="check"><input type="checkbox" value="${esc(role)}" ${grant.roles.includes(role) ? 'checked' : ''}> ${esc(role)}</label>`).join('')}</div>
    <button type="button" class="link-button remove-grant">Remove account</button>`;
  row.querySelector('select').value = grant.account_id || '';
  row.querySelector('.remove-grant').onclick = () => row.remove();
  $('accountRoleRows').appendChild(row);
}
$('addAccountRole').onclick = () => addAccountRoleRow();

async function refreshUsers() {
  if (!hasRole('Administrator')) return;
  try {
    const users = await api('/api/admin/users');
    $('usersTable')._rows = users;
    $('usersTable').innerHTML = tableHtml(users, [['display_name', 'Name'], ['username', 'Username'], ['roles', 'Account / roles', (v, r) =>
      v.map(pill).join(' ') + r.account_roles.map(g => `<div><strong>${esc(g.account_name)}</strong><br>${g.roles.map(pill).join(' ')}</div>`).join('') + (r.assignment_required ? '<span class="notice warn">Account assignment required</span>' : '')], ['active', 'Active', v => v ? 'Yes' : 'No']],
      r => `<button class="link-button edit-user" data-user="${esc(r.username)}">Edit</button>`);
  } catch (error) { toast(error.message, true); }
}
$('usersTable').addEventListener('click', e => {
  const button = e.target.closest('.edit-user');
  if (!button) return;
  const u = $('usersTable')._rows.find(u => u.username === button.dataset.user);
  $('adminUsername').value = u.username; $('adminUsername').readOnly = true;
  $('adminDisplayName').value = u.display_name; $('adminPassword').value = '';
  $('adminUserActive').checked = !!u.active; $('adminMustChange').checked = !!u.must_change_password;
  $('globalAdminRole').checked = u.roles.includes('Administrator');
  $('accountRoleRows').replaceChildren(); u.account_roles.forEach(addAccountRoleRow);
  $('userAssignmentNotice').textContent = u.assignment_required ? `Assign accounts to enable access. Previous roles: ${u.legacy_roles.join(', ') || 'None'}.` : '';
});
$('userForm').addEventListener('submit', async e => {
  e.preventDefault();
  const grants = [...document.querySelectorAll('.account-role-row')].map(row => ({account_id: Number(row.querySelector('select').value), roles: [...row.querySelectorAll('input:checked')].map(x => x.value)}));
  if (grants.some(g => !g.account_id || !g.roles.length)) {toast('Select an account and at least one role for each row.', true); return;}
  if (new Set(grants.map(g => g.account_id)).size !== grants.length) {toast('Use one role row per account.', true); return;}
  try {
    await api('/api/admin/users', {method: 'POST', body: {username: $('adminUsername').value, display_name: $('adminDisplayName').value,
      password: $('adminPassword').value || null, roles: $('globalAdminRole').checked ? ['Administrator'] : [], account_roles: grants,
      active: $('adminUserActive').checked, must_change_password: $('adminMustChange').checked}});
    e.target.reset(); $('adminUsername').readOnly = false; $('accountRoleRows').replaceChildren(); $('userAssignmentNotice').textContent = '';
    state.me = await api('/api/quality/me'); showApp();
    await refreshUsers(); toast('User saved.');
  } catch (error) { toast(error.message, true); }
});

let scorecardListRequest = 0;
async function refreshAdminScorecards() {
  const request = ++scorecardListRequest;
  $('adminScorecardsTable').innerHTML = '<p class="muted">Loading scorecards…</p>';
  const q = new URLSearchParams();
  if ($('scorecardAccount').value) q.set('account_id', $('scorecardAccount').value);
  if ($('scorecardProcess').value) q.set('process_id', $('scorecardProcess').value);
  try {
    const cards = await api(`/api/scorecards?${q}`);
    if (request !== scorecardListRequest) return;
    state.scorecards = cards;
    $('adminScorecardsTable').innerHTML = tableHtml(cards, [['account_name', 'Account'], ['process_name', 'Process'], ['name', 'Name'], ['version', 'Version'], ['status', 'Status', pill], ['item_count', 'Items']],
      r => `<button class="link-button edit-scorecard" data-id="${r.id}">${r.status === 'DRAFT' ? 'Edit draft' : 'View / edit'}</button>`);
  } catch (error) { toast(error.message, true); }
}

function resetItemEditor() {
  state.editingItem = null; $('itemForm').reset();
  $('saveItemButton').textContent = 'Add item'; $('cancelItemEdit').classList.add('hide');
}
function openScorecardBuilder(id) {
  const card = state.scorecards.find(c => c.id === id);
  if (!card) return;
  if ($('scorecardAccount').value && String(card.account_id) !== $('scorecardAccount').value) return;
  if ($('scorecardProcess').value && String(card.process_id) !== $('scorecardProcess').value) return;
  state.currentScorecard = card; resetItemEditor();
  $('scorecardBuilder').classList.remove('hide');
  $('builderTitle').textContent = `${card.name} · v${card.version}`;
  $('builderMeta').textContent = `${card.account_name} / ${card.process_name} · ${card.status}`;
  const editable = card.status === 'DRAFT' && card.process_active && card.account_active;
  for (const id of ['itemForm', 'scorecardMetaForm', 'publishScorecard']) $(id).classList.toggle('hide', !editable);
  $('cloneScorecard').classList.toggle('hide', card.status === 'DRAFT' || !card.process_active || !card.account_active);
  $('editScorecardName').value = card.name; $('editScorecardPass').value = card.passing_score;
  $('editScorecardOpp').value = card.opportunities_per_unit; $('editScorecardCritical').checked = !!card.critical_fail_override;
  $('builderItems').innerHTML = tableHtml(card.items, [['category', 'CTQ'], ['name', 'Item'], ['item_type', 'Type'], ['weight', 'Weight', v => `${v}%`], ['severity', 'Severity'], ['critical', 'Critical', v => v ? 'Yes' : 'No']],
    editable ? r => `<button type="button" class="link-button item-edit" data-id="${r.id}">Edit</button><button type="button" class="link-button item-move" data-id="${r.id}" data-direction="-1" aria-label="Move ${esc(r.name)} up">↑</button><button type="button" class="link-button item-move" data-id="${r.id}" data-direction="1" aria-label="Move ${esc(r.name)} down">↓</button><button type="button" class="link-button item-delete" data-id="${r.id}">Remove</button>` : null);
}
$('adminScorecardsTable').onclick = e => {const b = e.target.closest('.edit-scorecard'); if (b) openScorecardBuilder(Number(b.dataset.id));};
$('scorecardForm').onsubmit = async e => {
  e.preventDefault();
  if (!selectedProcess('scorecard')) return;
  try {
    const card = await api('/api/admin/scorecards', {method: 'POST', body: {process_id: Number($('scorecardProcess').value), name: $('scorecardName').value,
      passing_score: Number($('scorecardPass').value), opportunities_per_unit: Number($('scorecardOpp').value), critical_fail_override: $('scorecardCritical').checked}});
    await refreshAdminScorecards(); openScorecardBuilder(card.id); toast('Draft scorecard created.');
  } catch (error) {toast(error.message, true);}
};
async function reloadBuilder(id) {await refreshAdminScorecards(); openScorecardBuilder(id);}
$('cloneScorecard').onclick = async () => {
  try {const c = await api(`/api/admin/scorecards/${state.currentScorecard.id}/clone`, {method: 'POST'}); await reloadBuilder(c.id); toast('New draft version ready to edit.');}
  catch (error) {toast(error.message, true);}
};
$('scorecardMetaForm').onsubmit = async e => {
  e.preventDefault(); const id = state.currentScorecard.id;
  try {await api(`/api/admin/scorecards/${id}`, {method: 'PUT', body: {process_id: state.currentScorecard.process_id, name: $('editScorecardName').value,
    passing_score: Number($('editScorecardPass').value), opportunities_per_unit: Number($('editScorecardOpp').value), critical_fail_override: $('editScorecardCritical').checked}});
    await reloadBuilder(id); toast('Scorecard details saved.');
  } catch (error) {toast(error.message, true);}
};
const itemFields = {item_type: 'itemType', category: 'itemCategory', name: 'itemName', weight: 'itemWeight', severity: 'itemSeverity', opportunity_count: 'itemOpp', target: 'itemTarget', lsl: 'itemLsl', usl: 'itemUsl', unit: 'itemUnit'};
$('builderItems').onclick = async e => {
  const button = e.target.closest('button[data-id]'); if (!button) return;
  const card = state.currentScorecard, item = card.items.find(i => i.id === Number(button.dataset.id));
  if (button.classList.contains('item-edit')) {
    state.editingItem = item;
    for (const [key, id] of Object.entries(itemFields)) $(id).value = item[key] ?? '';
    $('itemCritical').checked = !!item.critical; $('saveItemButton').textContent = 'Save item'; $('cancelItemEdit').classList.remove('hide'); return;
  }
  try {
    if (button.classList.contains('item-delete')) {
      if (!confirm(`Remove ${item.name} from this draft?`)) return;
      await api(`/api/admin/scorecards/${card.id}/items/${item.id}`, {method: 'DELETE'});
    } else {
      const index = card.items.indexOf(item), target = index + Number(button.dataset.direction);
      if (target < 0 || target >= card.items.length) return;
      const items = [...card.items]; [items[index], items[target]] = [items[target], items[index]];
      await api(`/api/admin/scorecards/${card.id}/reorder`, {method: 'PUT', body: {item_ids: items.map(i => i.id)}});
    }
    await reloadBuilder(card.id);
  } catch (error) {toast(error.message, true);}
};
$('cancelItemEdit').onclick = resetItemEditor;
$('itemForm').onsubmit = async e => {
  e.preventDefault(); const card = state.currentScorecard;
  const body = Object.fromEntries(Object.entries(itemFields).map(([key, id]) => [key, $(id).value]));
  for (const key of ['weight', 'opportunity_count']) body[key] = Number(body[key]);
  for (const key of ['target', 'lsl', 'usl']) body[key] = body[key] === '' ? null : Number(body[key]);
  body.unit ||= null; body.critical = $('itemCritical').checked;
  body.sort_order = state.editingItem?.sort_order ?? Math.max(0, ...card.items.map(i => i.sort_order)) + 1;
  try {
    await api(`/api/admin/scorecards/${card.id}/items${state.editingItem ? '/' + state.editingItem.id : ''}`, {method: state.editingItem ? 'PUT' : 'POST', body});
    await reloadBuilder(card.id); toast('Scorecard item saved.');
  } catch (error) {toast(error.message, true);}
};
$('publishScorecard').onclick = async () => {
  const id = state.currentScorecard.id;
  try {await api(`/api/admin/scorecards/${id}/publish`, {method: 'POST'}); await reloadBuilder(id); await refreshScorecards(); toast('Version published. Existing audits retain their original version.');}
  catch (error) {toast(error.message, true);}
};

$('policyForm').onsubmit = async e => {
  e.preventDefault(); const p = selectedProcess('policy'); if (!p) return;
  try {await api(`/api/admin/processes/${p.id}/settings`, {method: 'PUT', body: {sampling_frequency: $('policyFrequency').value,
    sampling_count: Number($('policyCount').value), assignment_mode: $('policyAssignment').value, subgroup_mode: $('policySubgroup').value,
    baseline_subgroups: Number($('policyBaseline').value), critical_capa_enabled: $('policyAutoCapa').checked, capa_due_days: Number($('policyCapaDays').value)}});
    await refreshMaster(); toast('Process policy saved.');
  } catch (error) {toast(error.message, true);}
};
$('accountPolicyForm').onsubmit = async e => {
  e.preventDefault(); const p = selectedProcess('config'); if (!p) return;
  try {await api(`/api/admin/processes/${p.id}/sampling-controls`, {method: 'PUT', body: {
    coverage_enabled: $('cfgCoverage').checked, coverage_period: $('cfgPeriod').value, audits_per_associate: Number($('cfgQuota').value),
    identifier_column_default: p.sampling_config.identifier_column_default, associate_column_default: p.sampling_config.associate_column_default,
    exclude_previously_sampled: $('cfgExclude').checked, case_insensitive_ids: $('cfgCaseInsensitive').checked}});
    await refreshMaster(); toast('Sampling controls saved for this process.');
  } catch (error) {toast(error.message, true);}
};

async function fillCapaOwners(select, accountId, current = '') {
  const groups = await Promise.all(['QA Reviewer', 'Operations Manager'].map(role => api(`/api/accounts/${accountId}/assignees?role=${encodeURIComponent(role)}`)));
  const users = [...new Map(groups.flat().map(u => [u.username, u])).values()];
  select.innerHTML = '<option value="">Unassigned</option>' + users.map(u => `<option value="${esc(u.username)}">${esc(u.display_name)}</option>`).join('');
  if (current && !users.some(u => u.username === current)) {
    const option = new Option(`${current} (current owner)`, current);
    select.add(option);
  }
  select.value = current;
}
let ownerRequest = 0;
$('newCapaProcess').addEventListener('change', async () => {
  const request = ++ownerRequest;
  const p = state.processes.find(p => String(p.id) === $('newCapaProcess').value);
  $('newCapaOwner').innerHTML = '<option value="">Unassigned</option>';
  if (!p) return;
  try {
    const options = document.createElement('select');
    await fillCapaOwners(options, p.account_id);
    if (request === ownerRequest) $('newCapaOwner').innerHTML = options.innerHTML;
  } catch (error) {toast(error.message, true);}
});
async function configureCapaEditor(capa) {
  const editable = hasRole('QA Reviewer', capa.account_id) || hasRole('Operations Manager', capa.account_id);
  await fillCapaOwners($('capaOwner'), capa.account_id, capa.owner || '');
  $('capaDetail').querySelectorAll('input,textarea,select').forEach(el => el.disabled = !editable);
  $('saveCapa').classList.toggle('hide', !editable);
  if ($('advanceCapa')) $('advanceCapa').classList.toggle('hide', !editable);
}
