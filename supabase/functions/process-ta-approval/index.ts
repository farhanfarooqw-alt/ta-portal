import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token, decision } = await req.json();
    if (!token || !decision) {
      return new Response(JSON.stringify({ error: "Token and decision are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["approve", "reject"].includes(decision)) {
      return new Response(JSON.stringify({ error: "Invalid decision." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pending, error: pendingErr } = await supabase
      .from("pending_tas")
      .select("*")
      .eq("approval_token", token)
      .single();

    if (pendingErr || !pending) {
      return new Response(JSON.stringify({ error: "Pending request not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pending.status !== "pending") {
      return new Response(JSON.stringify({ error: "This request has already been processed." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = decision === "approve" ? "approved" : "rejected";
    const { error: updateErr } = await supabase
      .from("pending_tas")
      .update({ status })
      .eq("approval_token", token);

    if (updateErr) {
      throw updateErr;
    }

    if (status === "approved") {
      if (!pending.auth_user_id) {
        return new Response(JSON.stringify({ error: "Missing TA user id. Cannot complete approval." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: tokenData, error: tokenErr } = await supabase.rpc("generate_class_token");
      if (tokenErr || !tokenData) {
        throw tokenErr || new Error("Failed to generate class link token.");
      }

      const profile = {
        id: pending.auth_user_id,
        ta_name: pending.ta_name,
        sir_name: pending.sir_name || pending.teacher_email,
        course: pending.course,
        email: pending.ta_email,
        class_link_token: tokenData as string,
        google_sheet_url: null,
      };

      const { error: profileErr } = await supabase
        .from("ta_profiles")
        .upsert(profile, { onConflict: "id" });

      if (profileErr) {
        throw profileErr;
      }
    }

    return new Response(JSON.stringify({ success: true, status }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
