import type { Metadata } from "next";
import { ProfileView } from "@/components/musea/profile-view";
import { RequireAuth } from "@/components/musea/require-auth";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileView />
    </RequireAuth>
  );
}
