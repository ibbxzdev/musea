"use client";

import {
  AtSign,
  Bell,
  ChevronRight,
  FileText,
  Hand,
  LogOut,
  MessageSquare,
  Moon,
  UserRoundMinus,
  UserRoundPen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ARTIFACTS, GALLERIES, PROFILE } from "@/lib/musea/fixtures";
import { cn } from "@/lib/utils";

export function ProfilePanel() {
  const savedCount = ARTIFACTS.length;
  const galleryCount = GALLERIES.length;
  const tagCount = new Set(ARTIFACTS.flatMap((artifact) => artifact.tags)).size;

  return (
    <div className="mx-auto max-w-xl">
      <header className="flex flex-col items-center text-center">
        <Avatar className="size-24 rounded-3xl">
          <AvatarImage src={PROFILE.avatarUrl} alt="" />
          <AvatarFallback className="rounded-3xl text-2xl font-semibold text-muted-foreground">
            {PROFILE.name
              .split(" ")
              .map((part) => part[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{PROFILE.name}</h2>
        <p className="text-sm text-muted-foreground">@{PROFILE.handle}</p>
        {PROFILE.bio && (
          <p className="mt-2 max-w-sm text-sm text-balance text-muted-foreground">{PROFILE.bio}</p>
        )}
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-2">
        <Stat label="Saves" value={savedCount} />
        <Stat label="Galleries" value={galleryCount} />
        <Stat label="Tags" value={tagCount} />
      </dl>

      <SettingsGroup label="Account">
        <SettingsRow icon={UserRoundPen} label="Edit profile" detail={PROFILE.name} />
        <SettingsRow icon={AtSign} label="Username" detail={`@${PROFILE.handle}`} />
      </SettingsGroup>

      <SettingsGroup label="Preferences">
        <SettingsRow icon={Moon} label="Appearance" detail="System" />
        <SettingsRow icon={Bell} label="Notifications" detail="On" />
      </SettingsGroup>

      <SettingsGroup label="Legal">
        <SettingsRow icon={Hand} label="Privacy policy" />
        <SettingsRow icon={FileText} label="Terms of service" />
        <SettingsRow icon={MessageSquare} label="Send feedback" />
      </SettingsGroup>

      <SettingsGroup label="Danger">
        <SettingsRow icon={LogOut} label="Sign out" />
        <SettingsRow icon={UserRoundMinus} label="Delete account" destructive />
      </SettingsGroup>

      <p className="mt-8 text-center text-xs text-muted-foreground">Musea for web — UI preview</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    // Flex + order so the number reads first while the markup keeps dt before dd.
    <div className="flex flex-col rounded-2xl bg-muted/60 px-3 py-4 text-center">
      <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
      <dd className="order-1 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
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
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        // min-h-12 rather than h-12: a row has to be able to grow, but never shrink below
        // the 44px target.
        "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
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
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}
