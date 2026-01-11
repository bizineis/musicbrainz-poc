import Link from "next/link";
import styles from "./recording.module.css";

type MusicBrainzArtistCredit = {
  name?: string;
  artist?: {
    id?: string;
    name?: string;
  };
};

type MusicBrainzRelease = {
  id?: string;
  title?: string;
  date?: string;
};

type MusicBrainzRecordingDetails = {
  id: string;
  title: string;
  length?: number;
  "artist-credit"?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
};

function getArtistNames(credits: MusicBrainzArtistCredit[] | undefined): string {
  if (!credits || credits.length === 0) return "Unknown artist";
  const names = credits
    .map((c) => c?.name ?? c?.artist?.name)
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  return names.length > 0 ? names.join(", ") : "Unknown artist";
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizePartialDate(date: string): string {
  if (date.length === 4) return `${date}-00-00`;
  if (date.length === 7) return `${date}-00`;
  return date;
}

function getFirstRelease(releases: MusicBrainzRelease[] | undefined): MusicBrainzRelease | null {
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const withDates = releases.filter(
    (r) => typeof r.date === "string" && r.date.trim().length > 0
  );
  const list = withDates.length > 0 ? withDates : releases;

  let best = list[0] ?? null;
  for (const r of list) {
    if (!best) {
      best = r;
      continue;
    }
    const a = typeof best.date === "string" ? normalizePartialDate(best.date) : "9999-99-99";
    const b = typeof r.date === "string" ? normalizePartialDate(r.date) : "9999-99-99";
    if (b < a) best = r;
  }

  return best;
}

async function fetchRecording(id: string): Promise<MusicBrainzRecordingDetails> {
  const userAgent =
    process.env.MUSICBRAINZ_USER_AGENT ??
    "musicbrainz-poc/0.1.0 (mailto:you@example.com)";

  const url = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(
    id
  )}?fmt=json&inc=artist-credits+releases`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "Request failed (403). MusicBrainz requires a valid User-Agent. Set MUSICBRAINZ_USER_AGENT to something like: MyApp/1.0.0 (you@example.com)"
      );
    }
    throw new Error(`Request failed (${res.status})`);
  }

  return (await res.json()) as MusicBrainzRecordingDetails;
}

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let recording: MusicBrainzRecordingDetails | null = null;
  let error: string | null = null;

  try {
    recording = await fetchRecording(id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  if (error || !recording) {
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <Link className={styles.backLink} href="/search">
            ← Back to search
          </Link>
          <div className={styles.error}>{error ?? "Unable to load recording"}</div>
        </main>
      </div>
    );
  }

  const artists = getArtistNames(recording["artist-credit"]);
  const duration = formatDuration(recording.length);
  const firstRelease = getFirstRelease(recording.releases);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Link className={styles.backLink} href="/search">
          ← Back to search
        </Link>

        <header className={styles.header}>
          <h1 className={styles.title}>{recording.title}</h1>
          <p className={styles.subtitle}>{artists}</p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Details</h2>
          <div className={styles.kv}>
            <div className={styles.kvRow}>
              <div className={styles.kvKey}>MBID</div>
              <div className={styles.kvValue}>
                <a
                  className={styles.externalLink}
                  href={`https://musicbrainz.org/recording/${recording.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {recording.id}
                </a>
              </div>
            </div>

            {firstRelease?.title ? (
              <div className={styles.kvRow}>
                <div className={styles.kvKey}>First release</div>
                <div className={styles.kvValue}>{firstRelease.title}</div>
              </div>
            ) : null}

            {firstRelease?.date ? (
              <div className={styles.kvRow}>
                <div className={styles.kvKey}>Release date</div>
                <div className={styles.kvValue}>{firstRelease.date}</div>
              </div>
            ) : null}

            {duration ? (
              <div className={styles.kvRow}>
                <div className={styles.kvKey}>Duration</div>
                <div className={styles.kvValue}>{duration}</div>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
