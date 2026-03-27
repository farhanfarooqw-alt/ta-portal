// ============================================================
//  TA PORTAL — Supabase Edge Function
//  File: supabase/functions/send-marks-email/index.ts
//
//  Deploy:
//  supabase functions deploy send-marks-email
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const {
      student_name, student_email, ta_name, sir_name,
      course, category, marks, total, remarks, is_reminder
    } = await req.json();

    if (!student_email) {
      return new Response(JSON.stringify({ error: "No email address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const percentage = marks !== null ? ((marks / total) * 100).toFixed(1) : null;
    const grade = percentage !== null ? getGrade(parseFloat(percentage)) : '—';

    // ── Email HTML ──
    const isReminder = is_reminder === true;
    const subject = isReminder
      ? `⚠️ Missing Marks: ${category} — ${course}`
      : `📊 Your ${category} Marks — ${course}`;

    const bodyHtml = isReminder ? reminderEmail(student_name, ta_name, sir_name, course, category, total)
                                : marksEmail(student_name, ta_name, sir_name, course, category, marks, total, percentage, grade, remarks);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    `TA Portal <noreply@your-domain.com>`,
        to:      [student_email],
        subject,
        html:    bodyHtml,
      }),
    });

    if (!resendRes.ok) throw new Error(await resendRes.text());

    return new Response(JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ── Grade helper ──
function getGrade(pct: number): string {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

// ── Marks Email Template ──
function marksEmail(name: string, ta: string, sir: string, course: string,
  category: string, marks: number, total: number, pct: string, grade: string, remarks: string) {
  const color = parseFloat(pct) >= 60 ? '#38e5b0' : '#f77474';
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#f0f4f8;margin:0;padding:0}
  .wrap{max-width:540px;margin:36px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .head{background:linear-gradient(135deg,#4f8ef7,#38e5b0);padding:32px 36px;text-align:center}
  .head h1{color:#fff;font-size:1.4rem;margin:0}
  .head p{color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:0.88rem}
  .body{padding:32px 36px}
  .score-box{background:#f8faff;border:1px solid #dce8ff;border-radius:14px;padding:24px;text-align:center;margin:20px 0}
  .score-num{font-size:3rem;font-weight:800;color:${color};line-height:1}
  .score-out{font-size:1rem;color:#6b7a99}
  .score-grade{display:inline-block;background:${color}22;color:${color};border:1px solid ${color}55;padding:5px 18px;border-radius:100px;font-weight:700;font-size:0.9rem;margin-top:10px}
  .score-pct{font-size:0.85rem;color:#9aaccc;margin-top:6px}
  .info-row{display:flex;justify-content:space-between;padding:8px 0;font-size:0.88rem;border-bottom:1px solid #f0f4f8}
  .info-row:last-child{border:none}
  .lbl{color:#9aaccc}.val{color:#1a2235;font-weight:600}
  .remarks-box{background:#fffbf0;border:1px solid #fde8a0;border-radius:10px;padding:14px 16px;margin:18px 0;font-size:0.86rem;color:#7a6000}
  .footer{text-align:center;padding:18px;font-size:0.76rem;color:#9aaccc;border-top:1px solid #f0f4f8}
</style>
</head><body>
<div class="wrap">
  <div class="head"><h1>TA Portal 🎓</h1><p>Your marks are here!</p></div>
  <div class="body">
    <p>Dear <strong>${name}</strong>,</p>
    <p>Your marks for <strong>${category}</strong> have been recorded.</p>
    <div class="score-box">
      <div class="score-num">${marks}</div>
      <div class="score-out">out of ${total}</div>
      <div class="score-grade">${grade}</div>
      <div class="score-pct">${pct}%</div>
    </div>
    <div class="info-row"><span class="lbl">Course</span><span class="val">${course}</span></div>
    <div class="info-row"><span class="lbl">Category</span><span class="val">${category}</span></div>
    <div class="info-row"><span class="lbl">Teaching Assistant</span><span class="val">${ta}</span></div>
    <div class="info-row"><span class="lbl">Instructor</span><span class="val">${sir}</span></div>
    ${remarks ? `<div class="remarks-box">💬 <strong>Remarks:</strong> ${remarks}</div>` : ''}
    <p style="font-size:0.85rem;color:#6b7a99;margin-top:20px">If you have any questions about your marks, please contact your TA <strong>${ta}</strong>.</p>
  </div>
  <div class="footer">TA Portal &nbsp;·&nbsp; Automated email &nbsp;·&nbsp; Do not reply</div>
</div>
</body></html>`;
}

// ── Reminder Email Template ──
function reminderEmail(name: string, ta: string, sir: string, course: string, category: string, total: number) {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#f0f4f8;margin:0;padding:0}
  .wrap{max-width:540px;margin:36px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .head{background:linear-gradient(135deg,#f7c948,#f7a648);padding:32px 36px;text-align:center}
  .head h1{color:#fff;font-size:1.4rem;margin:0}
  .head p{color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:0.88rem}
  .body{padding:32px 36px}
  .warn-box{background:#fffbf0;border:1px solid #fde8a0;border-radius:14px;padding:22px;text-align:center;margin:20px 0}
  .warn-icon{font-size:2.5rem;margin-bottom:10px}
  .warn-box h3{color:#7a5c00;margin:0 0 6px}
  .warn-box p{color:#9a7a00;font-size:0.86rem;margin:0}
  .info-row{display:flex;justify-content:space-between;padding:8px 0;font-size:0.88rem;border-bottom:1px solid #f0f4f8}
  .info-row:last-child{border:none}
  .lbl{color:#9aaccc}.val{color:#1a2235;font-weight:600}
  .footer{text-align:center;padding:18px;font-size:0.76rem;color:#9aaccc;border-top:1px solid #f0f4f8}
</style>
</head><body>
<div class="wrap">
  <div class="head"><h1>TA Portal ⚠️</h1><p>Missing marks reminder</p></div>
  <div class="body">
    <p>Dear <strong>${name}</strong>,</p>
    <div class="warn-box">
      <div class="warn-icon">⚠️</div>
      <h3>Marks Not Recorded</h3>
      <p>Your marks for <strong>${category}</strong> (out of ${total}) have not been entered yet.</p>
    </div>
    <div class="info-row"><span class="lbl">Course</span><span class="val">${course}</span></div>
    <div class="info-row"><span class="lbl">Category</span><span class="val">${category}</span></div>
    <div class="info-row"><span class="lbl">Teaching Assistant</span><span class="val">${ta}</span></div>
    <div class="info-row"><span class="lbl">Instructor</span><span class="val">${sir}</span></div>
    <p style="font-size:0.85rem;color:#6b7a99;margin-top:20px">Please contact your TA <strong>${ta}</strong> to resolve this as soon as possible.</p>
  </div>
  <div class="footer">TA Portal &nbsp;·&nbsp; Automated reminder &nbsp;·&nbsp; Do not reply</div>
</div>
</body></html>`;
}