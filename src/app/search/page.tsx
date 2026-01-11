"use client";

import { useMemo, useState } from "react";
import styles from "./search.module.css";

type MusicBrainzArtistCredit = {
  name?: string;
  artist?: {
    id?: string;
    name?: string;
  };
};

type MusicBrainzRecording = {
  id: string;
  title: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
  length?: number;
  releases?: {
    id?: string;
    title?: string;
    date?: string;
    status?: string;
    "release-group"?: {
      id?: string;
      title?: string;
      "primary-type"?: string;
      "secondary-types"?: string[];
      disambiguation?: string;
    };
    disambiguation?: string;
  }[];
};

type MusicBrainzRecordingResponse = {
  recordings?: MusicBrainzRecording[];
  count?: number;
  offset?: number;
};

type MusicBrainzRelease = NonNullable<MusicBrainzRecording["releases"]>[number];

type CanonicalReleaseGroup = {
  id?: string;
  title?: string;
  primaryType?: string;
  secondaryTypes?: string[];
};

type CanonicalMatch = {
  recordingMbid: string;
  title: string;
  artist: string;
  releaseGroup: CanonicalReleaseGroup | null;
};

function normalizePartialDate(date: string): string {
  if (date.length === 4) return `${date}-00-00`;
  if (date.length === 7) return `${date}-00`;
  return date;
}

function pickCanonicalRelease(releases: MusicBrainzRecording["releases"]): MusicBrainzRelease | null {
  if (!Array.isArray(releases) || releases.length === 0) return null;

  let best: MusicBrainzRelease | null = null;
  let bestDate = "9999-99-99";
  let bestQuality = 9999;
  let bestPrimary = 9999;

  for (const r of releases) {
    const rawDate = typeof r.date === "string" ? r.date.trim() : "";
    const dateKey = rawDate.length > 0 ? normalizePartialDate(rawDate) : "9999-99-99";
    const quality = getReleaseQualityPenalty(r);
    const primary = getPrimaryReleaseGroupPenalty(r);

    if (!best) {
      best = r;
      bestDate = dateKey;
      bestQuality = quality;
      bestPrimary = primary;
      continue;
    }

    if (dateKey !== bestDate) {
      if (dateKey < bestDate) {
        best = r;
        bestDate = dateKey;
        bestQuality = quality;
        bestPrimary = primary;
      }
      continue;
    }

    if (quality !== bestQuality) {
      if (quality < bestQuality) {
        best = r;
        bestQuality = quality;
        bestPrimary = primary;
      }
      continue;
    }

    if (primary !== bestPrimary) {
      if (primary < bestPrimary) {
        best = r;
        bestPrimary = primary;
      }
      continue;
    }
  }

  return best;
}

function toCanonicalMatch(recording: MusicBrainzRecording): CanonicalMatch {
  const canonicalRelease = pickCanonicalRelease(recording.releases);
  const releaseGroup = canonicalRelease?.["release-group"]
    ? {
        id: canonicalRelease["release-group"].id,
        title: canonicalRelease["release-group"].title,
        primaryType: canonicalRelease["release-group"]["primary-type"],
        secondaryTypes: canonicalRelease["release-group"]["secondary-types"],
      }
    : null;

  return {
    recordingMbid: recording.id,
    title: recording.title,
    artist: getArtistName(recording),
    releaseGroup,
  };
}

function escapeQueryValue(value: string): string {
  return value.replaceAll('"', "\\\"");
}

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

function isExactArtistMatch(recording: MusicBrainzRecording, artist: string): boolean {
  const target = normalizeForCompare(artist);
  if (target.length === 0) return false;
  const credits = recording["artist-credit"];
  if (!credits || credits.length === 0) return false;
  return credits.some((c) => {
    const name = c?.name ?? c?.artist?.name;
    if (!name) return false;
    return normalizeForCompare(name) === target;
  });
}

function getEarliestReleaseDate(releases: MusicBrainzRecording["releases"]): string {
  if (!Array.isArray(releases) || releases.length === 0) return "9999-99-99";
  let best = "9999-99-99";
  for (const r of releases) {
    const raw = typeof r.date === "string" ? r.date.trim() : "";
    if (raw.length === 0) continue;
    const norm = normalizePartialDate(raw);
    if (norm < best) best = norm;
  }
  return best;
}

function includesAny(haystack: string, needles: string[]): boolean {
  const h = normalizeForCompare(haystack);
  return needles.some((n) => h.includes(n));
}

function getReleaseQualityPenalty(r: NonNullable<MusicBrainzRecording["releases"]>[number]): number {
  const status = typeof r.status === "string" ? normalizeForCompare(r.status) : "";
  const group = r["release-group"];
  const primaryType = typeof group?.["primary-type"] === "string" ? normalizeForCompare(group["primary-type"]) : "";
  const secondaryTypes = Array.isArray(group?.["secondary-types"])
    ? group["secondary-types"].map(normalizeForCompare)
    : [];

  const combinedText = [r.title, r.disambiguation, group?.title, group?.disambiguation]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");

  const reissueTerms = [
    "remaster",
    "remastered",
    "deluxe",
    "expanded",
    "anniversary",
    "edition",
    "reissue",
    "bonus",
  ];

  let penalty = 0;

  if (status === "bootleg") penalty += 100;
  else if (status.length > 0 && status !== "official") penalty += 15;

  if (secondaryTypes.includes("compilation")) penalty += 25;
  if (secondaryTypes.includes("live")) penalty += 25;
  if (secondaryTypes.includes("remix")) penalty += 20;
  if (secondaryTypes.includes("soundtrack")) penalty += 20;

  if (includesAny(combinedText, reissueTerms)) penalty += 10;

  if (primaryType.length > 0 && !["album", "single", "ep"].includes(primaryType)) {
    penalty += 8;
  }

  return penalty;
}

function getPrimaryReleaseGroupPenalty(r: NonNullable<MusicBrainzRecording["releases"]>[number]): number {
  const group = r["release-group"];
  const secondaryTypes = Array.isArray(group?.["secondary-types"]) ? group["secondary-types"] : [];
  let penalty = 0;
  if (!group?.id) penalty += 5;
  if (secondaryTypes.length > 0) penalty += 5;

  const combinedText = [r.title, r.disambiguation, group?.disambiguation]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");

  const secondaryTerms = ["remaster", "remastered", "deluxe", "expanded", "anniversary", "edition", "reissue"];
  if (includesAny(combinedText, secondaryTerms)) penalty += 5;
  return penalty;
}

function rankRecordings(args: {
  recordings: MusicBrainzRecording[];
  artistQuery: string;
}): MusicBrainzRecording[] {
  const artist = args.artistQuery.trim();

  const scored = args.recordings.map((rec) => {
    const artistMatch = isExactArtistMatch(rec, artist);
    const earliestDate = getEarliestReleaseDate(rec.releases);

    const releases = Array.isArray(rec.releases) ? rec.releases : [];
    let bestQuality = 9999;
    let bestPrimaryPenalty = 9999;

    for (const r of releases) {
      const q = getReleaseQualityPenalty(r);
      if (q < bestQuality) bestQuality = q;
      const p = getPrimaryReleaseGroupPenalty(r);
      if (p < bestPrimaryPenalty) bestPrimaryPenalty = p;
    }

    if (bestQuality === 9999) bestQuality = 999;
    if (bestPrimaryPenalty === 9999) bestPrimaryPenalty = 99;

    return {
      rec,
      artistMatch,
      earliestDate,
      bestQuality,
      bestPrimaryPenalty,
    };
  });

  scored.sort((a, b) => {
    if (a.artistMatch !== b.artistMatch) return a.artistMatch ? -1 : 1;
    if (a.earliestDate !== b.earliestDate) return a.earliestDate < b.earliestDate ? -1 : 1;
    if (a.bestQuality !== b.bestQuality) return a.bestQuality - b.bestQuality;
    if (a.bestPrimaryPenalty !== b.bestPrimaryPenalty) return a.bestPrimaryPenalty - b.bestPrimaryPenalty;
    return a.rec.id.localeCompare(b.rec.id);
  });

  return scored.map((s) => s.rec);
}

function buildRecordingSearchQuery(args: {
  title: string;
  artist: string;
}): string {
  const parts: string[] = [];

  const title = args.title.trim();
  const artist = args.artist.trim();

  if (title.length > 0) {
    parts.push(`recording:"${escapeQueryValue(title)}"`);
  }

  if (artist.length > 0) {
    parts.push(`artist:"${escapeQueryValue(artist)}"`);
  }

  return parts.join(" AND ");
}

function getArtistName(r: MusicBrainzRecording): string {
  const credits = r["artist-credit"];
  if (!credits || credits.length === 0) return "Unknown artist";
  const names = credits
    .map((c) => c?.name ?? c?.artist?.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  if (names.length === 0) return "Unknown artist";
  return names.join(", ");
}

export default function SearchPage() {
  const [titleQuery, setTitleQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canonical, setCanonical] = useState<CanonicalMatch | null>(null);

  const heading = useMemo(() => {
    if (!submittedQuery) return "Search recordings";
    return `Results for \"${submittedQuery}\"`;
  }, [submittedQuery]);

  async function runSearch(args: { title: string; artist: string }) {
    const queryString = buildRecordingSearchQuery(args);
    const trimmed = queryString.trim();
    setSubmittedQuery(trimmed.length > 0 ? `${args.title.trim()}${args.artist.trim().length > 0 ? ` — ${args.artist.trim()}` : ""}`.trim() : null);

    if (trimmed.length === 0) {
      setError(null);
      setCanonical(null);
      sessionStorage.removeItem("musicbrainz_canonical_match");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
        trimmed
      )}&inc=releases+release-groups&fmt=json`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }

      const data = (await res.json()) as MusicBrainzRecordingResponse;
      const recordings = Array.isArray(data.recordings) ? data.recordings : [];
      const ranked = rankRecordings({ recordings, artistQuery: args.artist });
      const best = ranked[0];
      if (!best) {
        setCanonical(null);
        sessionStorage.removeItem("musicbrainz_canonical_match");
        throw new Error("No canonical match found.");
      }

      const nextCanonical = toCanonicalMatch(best);
      setCanonical(nextCanonical);
      sessionStorage.setItem(
        "musicbrainz_canonical_match",
        JSON.stringify(nextCanonical)
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      setCanonical(null);
      sessionStorage.removeItem("musicbrainz_canonical_match");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.header}>
          <h1 className={styles.title}>{heading}</h1>
          <p className={styles.subtitle}>
            Search the MusicBrainz database for recordings.
          </p>
        </div>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch({ title: titleQuery, artist: artistQuery });
          }}
        >
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
              placeholder="Song title"
              aria-label="Song title"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              placeholder="Artist name"
              aria-label="Artist name"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button className={styles.button} type="submit" disabled={isLoading}>
            {isLoading ? "Searching…" : "Search"}
          </button>
        </form>

        {error ? <div className={styles.error}>{error}</div> : null}

        {!error && !isLoading && submittedQuery && canonical ? (
          <div className={styles.empty}>Normalization complete.</div>
        ) : null}
      </main>
    </div>
  );
}
