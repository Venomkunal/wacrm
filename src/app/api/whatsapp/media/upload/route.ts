import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadMedia } from "@/lib/whatsapp/meta-api"; 
import { decrypt } from "@/lib/whatsapp/encryption";

export async function POST(request: Request) {
  try {
    console.log("--- NEW MEDIA UPLOAD REQUEST ---");
    const supabase = await createClient();
    
    // 1. Safely Check Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error("❌ 1. Supabase Auth Error:", authError.message);
      return NextResponse.json(
        { error: "Your session expired. Please log out and log back in." }, 
        { status: 401 }
      );
    }
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // console.log("✅ 2. User authenticated:", user.id);

    // 2. Fetch Profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .single();

    if (profileError || !profile?.account_id) {
      console.error("❌ 3. Profile Error:", profileError);
      return NextResponse.json({ error: "Could not find user profile." }, { status: 400 });
    }

    // 3. Fetch Meta Credentials
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("access_token, phone_number_id")
      .eq("account_id", profile.account_id)
      .single();

    if (configError || !config?.access_token || !config?.phone_number_id) {
      console.error("❌ 4. Config Error:", configError);
      return NextResponse.json(
        { error: "WhatsApp integration is not configured." },
        { status: 400 }
      );
    }

    // console.log("✅ 5. Database credentials found. Uploading to Meta...");

    // 4. Extract File
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file was provided." }, { status: 400 });
    }

    // 5. Upload to Meta
    // If THIS fails, the catch block at the bottom will log it.
    const accessToken = decrypt(config.access_token);
    const result = await uploadMedia({
      phoneNumberId: config.phone_number_id,
      accessToken,
      file,
    });

    // console.log("✅ 6. Upload successful! Meta ID:", result.id);

    return NextResponse.json({
      mediaId: result.id,
      phoneNumberId: config.phone_number_id,
    });

  } catch (error) {
    // This will catch the EXACT error thrown by Meta if the token is bad
    console.error("❌ CRASH IN ROUTE.TS:", error);
    
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
