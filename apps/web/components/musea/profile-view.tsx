"use client";

import { api } from "@musea/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  AtSign,
  ChevronRight,
  Loader2,
  LogOut,
  type LucideIcon,
  UserRoundMinus,
  UserRoundPen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { initialsOf } from "@/lib/musea/format";
import type { Viewer } from "@/lib/musea/types";
import { cn } from "@/lib/utils";
import { ResponsiveModal } from "./responsive-modal";
import { ConnectWallet } from "./connect-wallet";

/**
 * The account section.
 *
 * The phone app's Settings tab, minus everything the web version does not have: no
 * paywall or plan row (RevenueCat is not ported), no appearance or notification toggles
 * (both are OS-level settings on iOS with no web equivalent here), no feedback form.
 * What is left is what an account genuinely needs: who you are, and how to leave.
 */
export function ProfileView() {
  const viewer = useQuery(api.users.viewer, {});
  const stats = useQuery(api.users.stats, {});

  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  if (viewer === undefined || viewer === null) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <div className="mx-auto size-24 animate-pulse rounded-3xl bg-muted" />
        <div className="mx-auto h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="sr-only">Profile</h1>

      <header className="flex flex-col items-center text-center">
        <Avatar className="size-24 rounded-3xl">
          <AvatarImage src={viewer.imageUrl} alt="" />
          <AvatarFallback className="rounded-3xl text-2xl font-semibold text-muted-foreground">
            {initialsOf(viewer.name)}
          </AvatarFallback>
        </Avatar>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{viewer.name}</h2>
        <p className="text-sm text-muted-foreground">@{viewer.handle}</p>
        {viewer.bio && (
          <p className="mt-2 max-w-sm text-sm text-balance text-muted-foreground">{viewer.bio}</p>
        )}
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-2">
        <Stat label="Saves" value={stats?.saves} />
        <Stat label="Galleries" value={stats?.galleries} />
        <Stat label="Tags" value={stats?.tags} />
      </dl>

      <ConnectWallet />

      <SettingsGroup label="Account">
        <SettingsRow
          icon={UserRoundPen}
          label="Edit profile"
          detail={viewer.name}
          onClick={() => setEditing(true)}
        />
        {/*
          The handle is assigned at sign-up and not editable here. Changing it needs a
          uniqueness check against every existing handle, and the backend has no mutation
          for it — a row that opened a rename sheet with nothing behind it would be worse
          than one that plainly shows what your handle is.
        */}
        <SettingsRow icon={AtSign} label="Username" detail={`@${viewer.handle}`} />
      </SettingsGroup>

      <SettingsGroup label="Danger">
        <SignOutRow />
        <SettingsRow
          icon={UserRoundMinus}
          label="Delete account"
          destructive
          onClick={() => setConfirmingDelete(true)}
        />
      </SettingsGroup>

      <EditProfileModal viewer={viewer} open={editing} onOpenChange={setEditing} />
      <DeleteAccountModal open={confirmingDelete} onOpenChange={setConfirmingDelete} />
    </div>
  );
}

function SignOutRow() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await authClient.signOut();
      router.push("/sign-in");
    } catch {
      toast.error("Could not sign out.");
      setBusy(false);
    }
  };

  return <SettingsRow icon={LogOut} label="Sign out" onClick={signOut} disabled={busy} />;
}

function EditProfileModal({
  viewer,
  open,
  onOpenChange,
}: {
  viewer: Viewer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateProfile = useMutation(api.users.updateProfile);

  const [name, setName] = React.useState(viewer.name);
  const [bio, setBio] = React.useState(viewer.bio ?? "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(viewer.name);
      setBio(viewer.bio ?? "");
    }
  }, [open, viewer.name, viewer.bio]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving) return;

    setSaving(true);
    try {
      await updateProfile({ name, bio });
      onOpenChange(false);
      toast.success("Profile updated");
    } catch {
      toast.error("Could not save that.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit profile"
      description="How other curators see you."
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="space-y-3 px-5 pb-4 sm:px-6">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11"
              autoComplete="name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-bio">Bio</Label>
            <Textarea
              id="profile-bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Optional. What do you collect?"
              className="min-h-24 resize-none"
            />
          </div>
        </div>

        <div className="pb-safe sticky bottom-0 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
          <Button
            type="submit"
            disabled={!name.trim() || saving}
            className="h-11 w-full rounded-full"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

/**
 * Type-to-confirm rather than an "Are you sure?" — this deletes every artifact and
 * gallery the account has, and the backend cannot put them back.
 */
function DeleteAccountModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteAccount = useMutation(api.users.deleteAccount);
  const router = useRouter();

  const [confirmation, setConfirmation] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmation.trim().toLowerCase() !== "delete" || busy) return;

    setBusy(true);
    try {
      await deleteAccount({});
      router.push("/sign-in");
    } catch {
      toast.error("Could not delete the account.");
      setBusy(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Delete account"
      description="Every artifact and gallery goes with it. This cannot be undone."
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="space-y-3 px-5 pb-4 sm:px-6">
          <p className="text-sm text-muted-foreground text-pretty">
            Your saves, your galleries and the files you uploaded are deleted permanently. Tips you
            have already sent or received stay on the Stellar ledger — nothing here can unsend
            those.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">
              Type <span className="font-semibold">delete</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="h-11"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="pb-safe sticky bottom-0 border-t bg-background/95 px-5 pt-3 backdrop-blur sm:px-6">
          <Button
            type="submit"
            variant="destructive"
            disabled={confirmation.trim().toLowerCase() !== "delete" || busy}
            className="h-11 w-full rounded-full"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Delete my account"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    // Flex + order so the number reads first while the markup keeps dt before dd.
    <div className="flex flex-col rounded-2xl bg-muted/60 px-3 py-4 text-center">
      <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
      <dd className="order-1 text-xl font-semibold tracking-tight tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * An iOS grouped-list section: a quiet label above a single rounded card of rows, with
 * hairlines between rows rather than around each one.
 */
function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 ml-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </h3>
      <div className="divide-y overflow-hidden rounded-2xl border">{children}</div>
    </section>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  detail,
  destructive = false,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  destructive?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const interactive = Boolean(onClick);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !interactive}
      className={cn(
        // min-h-12 rather than h-12: a row has to be able to grow, but never shrink below
        // the 44px target.
        "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-none",
        interactive
          ? "hover:bg-accent focus-visible:bg-accent"
          : "cursor-default disabled:opacity-100",
        destructive && "text-destructive",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          destructive ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <span className="flex-1 truncate text-sm font-medium">{label}</span>
      {detail && <span className="truncate text-sm text-muted-foreground">{detail}</span>}
      {interactive && (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
      )}
    </button>
  );
}
