import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await admin.from("employees").select("name, email, role, employment_status").in("role", ["system_admin"]).order("name");
  console.log(JSON.stringify(data, null, 1));
}
main();
