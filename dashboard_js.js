const { data, error } = await sb.from('mark_categories').insert({
      ta_id: currentTA.id, name, total
    }).select().single();
    if (error) { showToast('❌','Failed: '+error.message); return; }
    closeAddCat();
    document.getElementById('cat-name').value  = '';
    document.getElementById('cat-total').value = '20';
    categories.push(data);
    renderCatTabs();
    selectCat(data.id);
    showToast('✅', `Category "${name}" created!`);
  }

  // ══ MARKS TABLE ══
  function renderMarksTable() {
    const approved = allStudents.filter(s=>s.status==='approved');
    const tbody = document.getElementById('marks-tbody');
    if (!activeCat) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="ei">📊</div><p>Select or create a category above.</p></div></td></tr>`;
      return;
    }
    if (!approved.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="ei">👥</div><p>No approved students yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = approved.map((s,i) => `
      <tr id="row-${s.id}">
        <td style="color:var(--muted)">${i+1}</td>
        <td><strong>${s.name}</strong></td>
        <td style="font-family:monospace;color:var(--accent);font-size:0.82rem">${s.roll_no}</td>
        <td>
          <input class="marks-input" id="mark-${s.id}" type="number"
            min="0" max="${activeCat.total}" placeholder="—"
            oninput="onMarkInput('${s.id}', this)" />
        </td>
        <td style="color:var(--muted)">${activeCat.total}</td>
        <td><input class="remarks-input" id="rem-${s.id}" type="text" placeholder="Optional remarks"/></td>
        <td id="email-status-${s.id}">
          <span class="email-dot none"></span><span style="font-size:0.78rem;color:var(--muted)">Not sent</span>
        </td>
      </tr>
    `).join('');
    updateProgress();
  }

  function onMarkInput(sid, input) {
    const val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) input.classList.add('filled');
    else { input.classList.remove('filled'); input.classList.add('missing'); }
    if (input.value === '') { input.classList.remove('filled','missing'); }
    updateProgress();
  }

  function updateProgress() {
    if (!activeCat) return;
    const approved = allStudents.filter(s=>s.status==='approved');
    let filled = 0;
    approved.forEach(s => {
      const v = document.getElementById(`mark-${s.id}`)?.value;
      if (v !== '' && v !== undefined && !isNaN(parseFloat(v))) filled++;
    });
    const total = approved.length;
    const pct   = total ? Math.round((filled/total)*100) : 0;
    document.getElementById('marks-prog-fill').style.width = pct+'%';
    document.getElementById('marks-prog-text').textContent = `${filled} / ${total} marks entered (${pct}%)`;
    document.getElementById('marks-progress-label').textContent = `${filled}/${total} filled`;
    document.getElementById('send-bar-sub').textContent =
      filled < total
        ? `⚠️ ${total-filled} student(s) have missing marks — use Remind Missing`
        : `All marks filled! Ready to send emails.`;
  }

  async function saveMarks() {
    if (!activeCat) return;
    const approved = allStudents.filter(s=>s.status==='approved');
    const rows = approved.map(s => ({
      student_id:  s.id,
      ta_id:       currentTA.id,
      category_id: activeCat.id,
      marks:       parseFloat(document.getElementById(`mark-${s.id}`)?.value) || null,
      total:       activeCat.total,
      remarks:     document.getElementById(`rem-${s.id}`)?.value || null,
    })).filter(r => r.marks !== null);

    if (!rows.length) { showToast('⚠️','No marks entered.'); return; }

    // Upsert marks
    const { error } = await sb.from('marks').upsert(rows, { onConflict: 'student_id,category_id' });
    if (error) { showToast('❌','Save failed: '+error.message); return; }
    showToast('✅', `${rows.length} marks saved!`);

    // Sync Google Sheets
    if (currentTA.google_sheet_url) {
      syncToSheets(rows, approved);
    }
  }

  // ══ SEND ALL EMAILS ══
  async function sendAllEmails() {
    if (!activeCat) return;
    const approved = allStudents.filter(s=>s.status==='approved' && s.email);
    if (!approved.length) { showToast('⚠️','No students with email addresses.'); return; }

    const btn = document.getElementById('send-all-btn');
    btn.disabled = true; btn.textContent = '⏳ Sending...';

    let sentCount = 0;
    for (const s of approved) {
      const markVal = parseFloat(document.getElementById(`mark-${s.id}`)?.value);
      if (isNaN(markVal)) continue; // skip missing

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-marks-email`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({
          student_name:  s.name,
          student_email: s.email,
          ta_name:       currentTA.ta_name,
          sir_name:      currentTA.sir_name,
          course:        currentTA.course,
          category:      activeCat.name,
          marks:         markVal,
          total:         activeCat.total,
          remarks:       document.getElementById(`rem-${s.id}`)?.value || '',
        })
      });

      if (res.ok) {
        sentCount++;
        // Update email status cell
        const cell = document.getElementById(`email-status-${s.id}`);
        if (cell) cell.innerHTML = `<span class="email-dot sent"></span><span style="font-size:0.78rem;color:var(--accent2)">Sent ✓</span>`;
      }
    }

    btn.disabled = false;
    btn.innerHTML = `<span class="sync-dot"></span>Send All Emails`;
    showToast('🎉', `Emails sent to ${sentCount} student(s)!`);
  }

  // ══ REMIND MISSING ══
  async function sendMissingReminders() {
    if (!activeCat) return;
    const approved = allStudents.filter(s=>s.status==='approved' && s.email);
    const missing  = approved.filter(s => {
      const v = document.getElementById(`mark-${s.id}`)?.value;
      return v === '' || v === undefined || isNaN(parseFloat(v));
    });

    if (!missing.length) { showToast('✅','No missing marks!'); return; }

    const btn = document.getElementById('remind-btn');
    btn.disabled = true; btn.textContent = '⏳ Sending...';

    let count = 0;
    for (const s of missing) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-marks-email`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({
          student_name:  s.name,
          student_email: s.email,
          ta_name:       currentTA.ta_name,
          sir_name:      currentTA.sir_name,
          course:        currentTA.course,
          category:      activeCat.name,
          marks:         null, // missing — reminder
          total:         activeCat.total,
          remarks:       'Your marks have not been recorded yet. Please contact your TA.',
          is_reminder:   true,
        })
      });
      if (res.ok) {
        count++;
        const cell = document.getElementById(`email-status-${s.id}`);
        if (cell) cell.innerHTML = `<span class="email-dot pending"></span><span style="font-size:0.78rem;color:var(--warn)">Reminded</span>`;
      }
    }

    btn.disabled = false; btn.textContent = '⚠️ Remind Missing';
    showToast('📧', `Reminder sent to ${count} student(s) with missing marks!`);
  }

  // ══ GOOGLE SHEETS SYNC ══
  async function syncToSheets(rows, students) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-to-sheets`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({
        sheet_url: currentTA.google_sheet_url,
        ta_name:   currentTA.ta_name,
        course:    currentTA.course,
        category:  activeCat.name,
        total:     activeCat.total,
        data: rows.map(r => {
          const s = students.find(x=>x.id===r.student_id);
          return { name:s?.name, roll_no:s?.roll_no, marks:r.marks, total:r.total, remarks:r.remarks };
        })
      })
    });
    if (res.ok) showToast('📊','Synced to Google Sheets!');
    else showToast('⚠️','Sheets sync failed. Check your URL.');
  }

  async function saveSheetUrl() {
    const url = document.getElementById('sheet-url').value.trim();
    if (!url) return;
    await sb.from('ta_profiles').update({ google_sheet_url: url }).eq('id', currentTA.id);
    currentTA.google_sheet_url = url;
    showToast('✅','Google Sheet URL saved!');
  }

  // ══ OVERVIEW ══
  function updateOverview() {
    document.getElementById('ov-total').textContent    = allStudents.length;
    document.getElementById('ov-approved').textContent = allStudents.filter(s=>s.status==='approved').length;
    document.getElementById('ov-pending').textContent  = allStudents.filter(s=>s.status==='pending').length;
    document.getElementById('ov-cats').textContent     = categories.length;

    const ovLink = document.getElementById('ov-link-box');
    if (currentTA?.class_link_token) {
      const url = `${location.origin}/join.html?ta=${currentTA.class_link_token}`;
      ovLink.innerHTML = `<div class="link-box"><span class="link-url">${url}</span><button class="copy-btn" onclick="copyLink('${url}')">Copy</button></div>`;
    }

    const recent = allStudents.slice(0,3);
    const ovR = document.getElementById('ov-recent');
    ovR.innerHTML = recent.length
      ? `<table><thead><tr><th>Name</th><th>Roll No.</th><th>Status</th></tr></thead><tbody>
          ${recent.map(s=>`<tr><td>${s.name}</td><td>${s.roll_no}</td><td>${badgeHtml(s.status)}</td></tr>`).join('')}
         </tbody></table>`
      : `<div class="empty-state"><div class="ei">👤</div><p>No students yet.</p></div>`;
  }

  // ══ STUDENTS ══
  let currentFilter = 'all';
  function filterStudents(f) {
    currentFilter = f;
    ['all','pending','approved','rejected'].forEach(x => {
      document.getElementById(`f-${x}`).className = x===f?'btn btn-primary btn-sm':'btn btn-ghost btn-sm';
    });
    renderStudents(f==='all' ? allStudents : allStudents.filter(s=>s.status===f));
  }

  function renderStudents(list) {
    document.getElementById('students-count').textContent = `${list.length} student${list.length!==1?'s':''}`;
    const tbody = document.getElementById('students-tbody');
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="ei">👤</div><p>No students.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map((s,i)=>`
      <tr>
        <td style="color:var(--muted)">${i+1}</td>
        <td><strong>${s.name}</strong></td>
        <td style="font-family:monospace;color:var(--accent);font-size:0.82rem">${s.roll_no}</td>
        <td style="color:var(--muted);font-size:0.8rem">${s.email||'—'}</td>
        <td>${badgeHtml(s.status)}</td>
        <td style="color:var(--muted);font-size:0.78rem">${new Date(s.created_at).toLocaleDateString('en-PK')}</td>
        <td><div class="action-btns">
          ${s.status==='pending'?`
            <button class="btn btn-success btn-sm" onclick="updateStudent('${s.id}','approved')">✅</button>
            <button class="btn btn-danger  btn-sm" onclick="updateStudent('${s.id}','rejected')">❌</button>`
          :s.status==='approved'?`<button class="btn btn-danger btn-sm" onclick="updateStudent('${s.id}','rejected')">Remove</button>`
          :`<button class="btn btn-ghost btn-sm" onclick="updateStudent('${s.id}','approved')">Re-approve</button>`}
        </div></td>
      </tr>`).join('');
  }

  async function updateStudent(id, status) {
    await sb.from('students').update({status}).eq('id',id);
    showToast('✅',`Student ${status}!`);
    await loadStudents();
    updateOverview();
    if (activeCat) renderMarksTable();
  }

  function badgeHtml(s) {
    const m={pending:'badge-pending',approved:'badge-approved',rejected:'badge-rejected'};
    const l={pending:'⏳ Pending',approved:'✅ Approved',rejected:'❌ Rejected'};
    return `<span class="badge ${m[s]||''}">${l[s]||s}</span>`;
  }

  // ══ CLASS LINK ══
  async function generateLink() {
    const { data } = await sb.rpc('generate_class_token');
    await sb.from('ta_profiles').update({class_link_token:data}).eq('id',currentTA.id);
    currentTA.class_link_token = data;
    renderLinkBox(data);
    updateOverview();
    showToast('🔗','New class link generated!');
  }

  function renderLinkBox(token) {
    const el = document.getElementById('link-display');
    if (!token) { el.innerHTML = '<p style="color:var(--muted);font-size:0.87rem">No link yet. Click Generate.</p>'; return; }
    const url = `${location.origin}/join.html?ta=${token}`;
    el.innerHTML = `
      <div class="link-box">
        <span class="link-url">${url}</span>
        <button class="copy-btn" onclick="copyLink('${url}')">📋 Copy</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <a href="https://wa.me/?text=${encodeURIComponent('Join my class: '+url)}" target="_blank" class="btn btn-ghost btn-sm">📱 WhatsApp</a>
        <a href="mailto:?subject=Join my TA class&body=${encodeURIComponent('Join here: '+url)}" class="btn btn-ghost btn-sm">✉️ Email</a>
      </div>`;
  }

  function copyLink(url) { navigator.clipboard.writeText(url).then(()=>showToast('📋','Copied!')); }

  // ══ PROFILE ══
  async function saveProfile() {
    const ta_name  = document.getElementById('p-ta-name').value.trim();
    const sir_name = document.getElementById('p-sir-name').value.trim();
    const course   = document.getElementById('p-course').value.trim();
    if (!ta_name||!sir_name||!course) { showToast('⚠️','Fill all fields.'); return; }
    const {error} = await sb.from('ta_profiles').update({ta_name,sir_name,course}).eq('id',currentTA.id);
    if (error) { showToast('❌','Save failed.'); return; }
    Object.assign(currentTA,{ta_name,sir_name,course});
    const ini = ta_name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    ['sb-avatar','profile-avatar'].forEach(id=>document.getElementById(id).textContent=ini);
    document.getElementById('sb-name').textContent              = ta_name;
    document.getElementById('profile-name-display').textContent = ta_name;
    document.getElementById('prev-ta-name').textContent         = ta_name;
    document.getElementById('prev-course').textContent          = course;
    document.getElementById('prev-sir').textContent             = sir_name;
    showToast('✅','Profile updated!');
  }

  async function handleLogout() { await sb.auth.signOut(); window.location.href='login.html'; }

  // ══ NAV ══
  const sectionMeta = {
    overview:{title:'Overview',   sub:'Your TA dashboard at a glance'},
    link:    {title:'Class Link', sub:'Share this link with your students'},
    students:{title:'Students',   sub:'Manage student registrations'},
    marks:   {title:'Marks',      sub:'Enter marks by category & send emails'},
    profile: {title:'My Profile', sub:'Update your TA information'},
  };
  function showSection(id) {
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    document.getElementById(`sec-${id}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    event?.currentTarget?.classList.add('active');
    const m=sectionMeta[id]||{};
    document.getElementById('page-title').textContent = m.title||id;
    document.getElementById('page-sub').textContent   = m.sub||'';
    closeSidebar();
  }

  function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('mob-overlay').classList.add('show'); }
  function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mob-overlay').classList.remove('show'); }

  let toastTimer;
  function showToast(icon,msg) {
    clearTimeout(toastTimer);
    document.getElementById('toast-icon').textContent=icon;
    document.getElementById('toast-msg').textContent=msg;
    const t=document.getElementById('toast');
    t.classList.add('show');
    toastTimer=setTimeout(()=>t.classList.remove('show'),3200);
  }