"use client";

import { Search, X } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * The iOS search field: pill, filled rather than outlined, glyph inside on the left, and
 * a clear button that only exists once there is something to clear.
 *
 * `type="search"` is deliberately avoided — Safari draws its own clear control on top of
 * ours, and it is well under the 44px target.
 */
export function SearchField({
  value,
  onValueChange,
  placeholder = "Search",
  className,
}: SearchFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        // h-11 keeps the field itself on the 44px grid.
        className="h-11 rounded-full border-transparent bg-muted pl-10 shadow-none focus-visible:border-transparent dark:bg-muted"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          // Visually a 20px glyph, but the hit area is the full height of the field.
          className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </div>
  );
}
