/**
 * Follow/unfollow artists via Supabase.  Data lives in the `follows` table
 * keyed by the Supabase auth.uid (GitHub login).  The hook exposes a
 * lightweight reactive list and mutators.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export interface FollowedArtist {
  artist_id: string;
  artist_name: string;
  artist_thumb: string;
}

export function useFollows() {
  const [following, setFollowing] = useState<FollowedArtist[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  /* ── Watch auth state ─────────────────────────────── */
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_ev, session) => { setUserId(session?.user?.id ?? null); }
    );
    return () => subscription.unsubscribe();
  }, []);

  /* ── Load follows whenever userId changes ──────────── */
  useEffect(() => {
    if (!userId) { setFollowing([]); return; }
    supabase!.from("follows")
      .select("artist_id, artist_name, artist_thumb")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => { if (!error) setFollowing(data as FollowedArtist[]); });
  }, [userId]);

  const isFollowing = useCallback(
    (artistId: string) => following.some(f => f.artist_id === artistId),
    [following]
  );

  const follow = useCallback(async (a: { artistId: string; name: string; thumb?: string }) => {
    if (!userId || !supabase) return;
    setFollowing(prev => [...prev, { artist_id: a.artistId, artist_name: a.name, artist_thumb: a.thumb ?? "" }]);
    await supabase!.from("follows").upsert({
      user_id: userId, artist_id: a.artistId, artist_name: a.name, artist_thumb: a.thumb ?? "",
    });
  }, [userId]);

  const unfollow = useCallback(async (artistId: string) => {
    setFollowing(prev => prev.filter(f => f.artist_id !== artistId));
    if (!userId || !supabase) return;
    await supabase!.from("follows").delete().eq("user_id", userId).eq("artist_id", artistId);
  }, [userId]);

  return { following, isFollowing, follow, unfollow, isLoggedIn: !!userId };
}