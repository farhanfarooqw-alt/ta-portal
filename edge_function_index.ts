// ============================================================
//  TA PORTAL — Supabase Edge Function
//  File: supabase/functions/send-ta-approval/index.ts
//
//  Deploy with:
//  supabase functions deploy send-ta-approval
//
//  Set secrets:
//  supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//  supabase secrets set SITE_URL=https://your-ta-portal.com
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { ta_name, ta_email, teacher_email, course } = body;

    // Validate required fields
    if (!ta_name || !ta_email || !teacher_email || !course) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Supabase Admin Client (service role) ──
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5500";

    // ── 1. Check teacher exists ──
    const { data: teacher, error: teacherErr } = await supabase
      .from("teachers")
      .select("name, email")
      .eq("email", teacher_email)
      .single();

    if (teacherErr || !teacher) {
      return new Response(
        JSON.stringify({ error: "Teacher email not found. Please ask your teacher to register first." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Generate approval token ──
    const { data: tokenData } = await supabase
      .rpc("generate_approval_token");
    const approvalToken = tokenData as string;

    // ── 3. Insert into pending_tas ──
    const { error: insertErr } = await supabase
      .from("pending_tas")
      .insert({
        ta_name,
        ta_email,
        teacher_email,
        course,
        approval_token: approvalToken,
        status: "pending",
      });

    if (insertErr) {
      // If TA already applied
      if (insertErr.code === "23505") {
        return new Response(
          JSON.stringify({ error: "You have already submitted a request. Please wait for teacher approval." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw insertErr;
    }

    // ── 4. Build approve/reject URLs ──
    const approveUrl = `${SITE_URL}/approve.html?token=${approvalToken}&action=approve`;
    const rejectUrl  = `${SITE_URL}/approve.html?token=${approvalToken}&action=reject`;

    // ── 5. Send email via Resend ──
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "TA Portal <noreply@your-domain.com>",  // replace with your Resend verified domain
        to:      [teacher_email],
        subject: `TA Request: ${ta_name} wants to be your TA for ${course}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #f0f4f8; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #4f8ef7, #38e5b0); padding: 36px 40px; text-align: center; }
    .header h1 { color: #fff; font-size: 1.5rem; margin: 0; }
    .header p  { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 0.9rem; }
    .body { padding: 36px 40px; }
    .info-box { background: #f8faff; border: 1px solid #dce8ff; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 0.9rem; }
    .info-row .label { color: #6b7a99; }
    .info-row .value { color: #1a2235; font-weight: 600; }
    .btn-row { display: flex; gap: 12px; margin: 28px 0 0; }
    .btn { flex: 1; text-align: center; padding: 14px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 0.95rem; }
    .btn-approve { background: #38e5b0; color: #0a2e22; }
    .btn-reject  { background: #f77474; color: #fff; }
    .footer { text-align: center; padding: 20px; font-size: 0.78rem; color: #9aaccc; border-top: 1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>TA Portal 🎓</h1>
      <p>New Teaching Assistant Request</p>
    </div>
    <div class="body">
      <p>Dear <strong>${teacher.name}</strong>,</p>
      <p>A student has requested to become your Teaching Assistant on <strong>TA Portal</strong>. Please review and approve or reject their request.</p>

      <div class="info-box">
        <div class="info-row"><span class="label">TA Name</span>     <span class="value">${ta_name}</span></div>
        <div class="info-row"><span class="label">TA Email</span>    <span class="value">${ta_email}</span></div>
        <div class="info-row"><span class="label">Course</span>      <span class="value">${course}</span></div>
        <div class="info-row"><span class="label">Requested</span>   <span class="value">${new Date().toLocaleDateString('en-PK', {dateStyle:'long'})}</span></div>
      </div>

      <p style="font-size:0.88rem; color:#6b7a99;">This link expires in <strong>48 hours</strong>.</p>

      <div class="btn-row">
        <a href="${approveUrl}" class="btn btn-approve">✅ Approve TA</a>
        <a href="${rejectUrl}"  class="btn btn-reject">❌ Reject</a>
      </div>
    </div>
    <div class="footer">TA Portal &nbsp;·&nbsp; This is an automated email &nbsp;·&nbsp; Do not reply</div>
  </div>
</body>
</html>
        `,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error(`Resend error: ${errText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Approval email sent to teacher!" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(
      JSON.stringify({ error: "Server error. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});