"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

type ResponsiveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read by assistive tech even when `hideHeader` keeps it off screen. */
  description?: string;
  /**
   * Hides the visible title row for surfaces that carry their own header — the artifact
   * viewer, where the picture is the subject and a title bar above it just gets in the
   * way. The accessible name is still announced.
   */
  hideHeader?: boolean;
  className?: string;
  children: React.ReactNode;
};

/**
 * One modal, two presentations: a bottom sheet on a phone, a centred dialog from `sm` up.
 *
 * iOS has no centred-dialog idiom for anything with content in it — sheets come up from
 * the bottom, within reach, and dismiss by dragging down. Vaul gives us that, including
 * the drag. Above 640px there is no thumb to be near and a sheet is just a tall column,
 * so it becomes a dialog.
 */
export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  hideHeader = false,
  className,
  children,
}: ResponsiveModalProps) {
  const isWide = useMediaQuery("(min-width: 640px)");

  if (isWide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn("max-h-[85dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg", className)}
        >
          <DialogHeader className={cn("px-6 pt-6", hideHeader && "sr-only")}>
            <DialogTitle className="text-xl font-semibold tracking-tight">{title}</DialogTitle>
            <DialogDescription className={cn(!description && "sr-only")}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      {/*
        The generated DrawerContent caps itself at `max-h-[80vh]` behind a
        `data-[vaul-drawer-direction=bottom]:` prefix. Repeating the prefix here is what
        lets tailwind-merge drop it — a bare `max-h-*` loses on specificity. dvh, not vh:
        Safari counts the URL bar in vh, so a vh sheet hangs off the bottom of the screen.
      */}
      <DrawerContent
        className={cn(
          "data-[vaul-drawer-direction=bottom]:max-h-[92dvh]",
          "data-[vaul-drawer-direction=bottom]:rounded-t-2xl",
          className,
        )}
      >
        <DrawerHeader className={cn("px-5 pt-1 pb-3", hideHeader && "sr-only")}>
          <DrawerTitle className="text-xl font-semibold tracking-tight">{title}</DrawerTitle>
          <DrawerDescription className={cn(!description && "sr-only")}>
            {description ?? title}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto overscroll-contain">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
