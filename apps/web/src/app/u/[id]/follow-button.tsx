"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toggleFollow } from "@/lib/profile-client";

interface Props {
  followedId: string;
  initialFollowing: boolean;
  initialFollowersCount: number;
  viewerSignedIn: boolean;
}

export function FollowButton({
  followedId,
  initialFollowing,
  viewerSignedIn,
}: Props) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!viewerSignedIn) {
      router.push(
        `/sign-in?next=${encodeURIComponent(`/u/${followedId}`)}`,
      );
      return;
    }
    setError(null);
    try {
      const result = await toggleFollow(followedId);
      setFollowing(result.following);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`rounded-md border px-4 py-1.5 text-sm font-medium transition ${
          following
            ? "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
            : "border-cyan-700 bg-cyan-900/40 text-cyan-100 hover:bg-cyan-800/60"
        } disabled:opacity-50`}
        aria-pressed={following}
      >
        {following ? "Following" : "Follow"}
      </button>
      {error && (
        <p className="text-[10px] text-rose-400">{error}</p>
      )}
    </div>
  );
}
